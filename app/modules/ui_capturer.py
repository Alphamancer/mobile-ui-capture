#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import io
import time
import traceback
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Dict, Tuple, Any, Optional, Callable
from PIL import Image

from .device_manager import DeviceManager

logger = logging.getLogger('XmlViewer.Modules')

class UICapturer:
    """UI捕获器，负责捕获Android设备的UI层次结构和截图"""
    
    def __init__(self, device_manager: DeviceManager):
        """初始化UI捕获器"""
        self.device_manager = device_manager
        self.last_xml = None
        self.last_screenshot = None
        self.last_capture_time = None
        self.last_error = None
        self.auto_capture_enabled = False
        self.auto_capture_interval = 3
        self.auto_capture_thread = None
        self.capture_callbacks = []
    
    def add_capture_callback(self, callback: Callable[[str, Optional[Image.Image]], None]) -> None:
        """添加捕获回调函数"""
        self.capture_callbacks.append(callback)
    
    def remove_capture_callback(self, callback: Callable) -> None:
        """移除捕获回调函数"""
        if callback in self.capture_callbacks:
            self.capture_callbacks.remove(callback)
    
    def capture_once(self) -> bool:
        """执行一次UI捕获"""
        if not self.device_manager.connected or not self.device_manager.device:
            logger.error("未连接设备")
            self.last_error = "未连接设备"
            return False
        
        try:
            logger.info("正在捕获UI")
            device = self.device_manager.device
            # 捕获XML
            xml_content = device.dump_hierarchy()
            self.last_xml = xml_content
            
            # 修改截图方式：先保存为临时文件，再读取
            import tempfile
            import os
            
            # 创建临时文件
            temp_png = tempfile.NamedTemporaryFile(suffix='.png', delete=False).name
            try:
                # 保存截图
                device.screenshot(temp_png)
                
                # 读取截图
                if os.path.exists(temp_png):
                    self.last_screenshot = Image.open(temp_png)
                    logger.info(f"截图保存为临时文件并成功读取: {temp_png}")
                else:
                    logger.error(f"截图文件未创建: {temp_png}")
                    self.last_screenshot = None
            finally:
                # 清理临时文件
                try:
                    if os.path.exists(temp_png):
                        os.unlink(temp_png)
                except Exception as e:
                    logger.warning(f"清理临时截图文件失败: {str(e)}")
            
            self.last_capture_time = time.time()
            self.last_error = None
            
            # 调用回调函数
            for callback in self.capture_callbacks:
                try:
                    callback(xml_content, self.last_screenshot)
                except Exception as e:
                    logger.error(f"执行捕获回调时出错: {str(e)}")
            
            logger.info("UI捕获完成")
            return True
        except Exception as e:
            logger.error(f"UI捕获失败: {str(e)}")
            self.last_error = str(e)
            return False
    
    def start_auto_capture(self, interval: int = 3) -> bool:
        """开始自动捕获"""
        if self.auto_capture_enabled:
            logger.warning("自动捕获已在运行")
            return True
        
        if not self.device_manager.connected:
            logger.error("未连接设备")
            self.last_error = "未连接设备"
            return False
        
        try:
            import threading
            self.auto_capture_interval = max(1, min(interval, 10))  # 限制在1-10秒之间
            self.auto_capture_enabled = True
            
            def auto_capture_thread():
                while self.auto_capture_enabled:
                    try:
                        self.capture_once()
                    except Exception as e:
                        logger.error(f"自动捕获过程中出错: {str(e)}")
                    time.sleep(self.auto_capture_interval)
            
            self.auto_capture_thread = threading.Thread(target=auto_capture_thread)
            self.auto_capture_thread.daemon = True
            self.auto_capture_thread.start()
            
            logger.info(f"自动捕获已启动, 间隔: {self.auto_capture_interval}秒")
            return True
        except Exception as e:
            logger.error(f"启动自动捕获失败: {str(e)}")
            self.last_error = str(e)
            self.auto_capture_enabled = False
            return False
    
    def stop_auto_capture(self) -> bool:
        """停止自动捕获"""
        if not self.auto_capture_enabled:
            logger.warning("自动捕获未在运行")
            return True
        
        try:
            self.auto_capture_enabled = False
            if self.auto_capture_thread and self.auto_capture_thread.is_alive():
                self.auto_capture_thread.join(1)
            self.auto_capture_thread = None
            
            logger.info("自动捕获已停止")
            return True
        except Exception as e:
            logger.error(f"停止自动捕获失败: {str(e)}")
            self.last_error = str(e)
            return False
    
    def get_capture_status(self) -> Dict[str, Any]:
        """获取当前捕获状态"""
        return {
            'auto_enabled': self.auto_capture_enabled,
            'interval': self.auto_capture_interval,
            'last_capture_time': self.last_capture_time,
            'has_screenshot': self.last_screenshot is not None,
            'has_xml': self.last_xml is not None,
            'error': self.last_error
        }
    
    def parse_hierarchy(self, xml_content: str = None) -> Tuple[Optional[ET.Element], Optional[List[Dict[str, Any]]], Optional[str]]:
        """解析UI层次结构XML"""
        xml_to_parse = xml_content or self.last_xml
        if not xml_to_parse:
            logger.error("没有可用的XML数据")
            return None, None, None
        
        try:
            root = ET.fromstring(xml_to_parse)
            # 从根节点开始提取，不传递 parent_id，让 _extract_node_data 内部处理根ID
            node_data = self._extract_node_data(root) 
            tree_html = self._generate_tree_html(root)
            return root, node_data, tree_html
        except Exception as e:
            logger.error(f"解析UI层次结构失败: {str(e)}")
            traceback.print_exc()
            return None, None, None
    
    def _extract_node_data(self, node: ET.Element, current_id_parts: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """递归提取节点数据，并使用基于路径的ID (e.g., node-0, node-0-0, node-0-1)"""
        result = []

        if current_id_parts is None:
            # 这是根节点
            current_id_parts = ["0"]
        
        node_id = "node-" + "-".join(current_id_parts)
        
        attrs = node.attrib.copy()
        
        node_data_entry = {
            'id': node_id,
            'tag': node.tag,
            'attributes': attrs,
            'children_ids': [], # 将存储子节点的ID
            'bounds': {'x1': 0, 'y1': 0, 'x2': 0, 'y2': 0}
        }

        if 'bounds' in attrs:
            try:
                bounds_str = attrs['bounds']
                if bounds_str.count('[') == 2 and bounds_str.count(']') == 2:
                    parts = bounds_str.replace('[', '').replace(']', ',').split(',')
                    if len(parts) >= 4:
                        left, top, right, bottom = map(int, parts[:4])
                        node_data_entry['bounds'] = {
                            'x1': left, 'y1': top, 'x2': right, 'y2': bottom
                        }
            except Exception as e:
                logger.error(f"解析位置信息失败: {str(e)} - bounds:{attrs.get('bounds', 'unknown')}, node_id: {node_id}")

        node_type = 'default'
        if attrs.get('clickable') == 'true':
            node_type = 'clickable'
        elif attrs.get('text') and attrs.get('text').strip():
            node_type = 'text'
        elif 'Image' in attrs.get('class', ''):
            node_type = 'image'
        node_data_entry['type'] = node_type
        node_data_entry['childCount'] = len(node)
        
        result.append(node_data_entry)
        
        for i, child_element in enumerate(node):
            child_id_parts = current_id_parts + [str(i)]
            node_data_entry['children_ids'].append("node-" + "-".join(child_id_parts))
            result.extend(self._extract_node_data(child_element, child_id_parts))
            
        return result
    
    def _generate_tree_html(self, node: ET.Element, level: int = 0, current_id_parts: Optional[List[str]] = None) -> str:
        """生成HTML树结构"""
        html = []
        indent = '  ' * level
        
        # 处理ID路径
        if current_id_parts is None:
            # 这是根节点
            current_id_parts = ["0"]
        
        # 生成与nodeData一致的结构化ID
        node_id = "node-" + "-".join(current_id_parts)
        
        # 获取节点属性
        attrs = node.attrib
        
        # 确定节点类型
        class_name = attrs.get('class', '')
        text = attrs.get('text', '')
        content_desc = attrs.get('content-desc', '')
        clickable = attrs.get('clickable', 'false') == 'true'
        
        # 生成节点描述
        node_desc = class_name.split('.')[-1]  # 仅使用类名的最后部分
        if text:
            node_desc += f": '{text}'"
        elif content_desc:
            node_desc += f": '{content_desc}'"
        
        # 添加CSS类
        css_classes = []
        if 'Image' in class_name:
            css_classes.append('node-image')
        elif text:
            css_classes.append('node-text')
        if clickable:
            css_classes.append('node-clickable')
        if not css_classes:
            css_classes.append('node-android')
        
        # 获取位置信息
        bounds = attrs.get('bounds', '')
        position = f"({bounds})" if bounds else ""
        
        # 计算子节点数量
        child_count = len(node)
        
        # 添加子节点数量显示，使用结构化ID
        child_count_html = f"<span class='node-count' data-node-id='{node_id}'>[{child_count}]</span>" if child_count > 0 else ""
        
        if child_count > 0:
            # 有子节点，使用details/summary
            html.append(f"{indent}<li>")
            html.append(f"{indent}  <details>")
            html.append(f"{indent}    <summary id='{node_id}' class='{' '.join(css_classes)}'>{node_desc} {position} {child_count_html}</summary>")
            html.append(f"{indent}    <ul>")
            
            for i, child in enumerate(node):
                child_id_parts = current_id_parts + [str(i)]
                html.append(self._generate_tree_html(child, level + 3, child_id_parts))
            
            html.append(f"{indent}    </ul>")
            html.append(f"{indent}  </details>")
            html.append(f"{indent}</li>")
        else:
            # 没有子节点，使用普通列表项
            html.append(f"{indent}<li><span id='{node_id}' class='{' '.join(css_classes)}'>{node_desc} {position}</span></li>")
        
        return "\n".join(html)
    
    def save_last_capture(self, xml_path: str, img_path: str = None) -> bool:
        """保存最近一次捕获的结果"""
        if not self.last_xml:
            logger.error("没有可用的XML数据")
            self.last_error = "没有可用的XML数据"
            return False
        
        try:
            # 保存XML
            os.makedirs(os.path.dirname(os.path.abspath(xml_path)), exist_ok=True)
            with open(xml_path, 'w', encoding='utf-8') as f:
                f.write(self.last_xml)
            
            # 保存截图
            if self.last_screenshot and img_path:
                os.makedirs(os.path.dirname(os.path.abspath(img_path)), exist_ok=True)
                self.last_screenshot.save(img_path)
            
            logger.info(f"已保存捕获结果: {xml_path}")
            return True
        except Exception as e:
            logger.error(f"保存捕获结果失败: {str(e)}")
            self.last_error = str(e)
            return False 