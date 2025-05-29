#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import time
import json
import logging
import threading
import sys
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from flask_socketio import SocketIO, emit
from PIL import Image
import io
import base64

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('XmlViewer')

# 导入自定义模块
from app.modules import DeviceManager, UICapturer

app = Flask(__name__, static_folder='app/static', template_folder='app/templates')
    
app.config['SECRET_KEY'] = 'xml_viewer_secret_key'
# 尝试这种初始化方式
socketio = SocketIO(app, cors_allowed_origins="*")

# 初始化设备管理器和UI捕获器
device_manager = DeviceManager()
ui_capturer = UICapturer(device_manager)

# 注册UI捕获回调
def on_ui_captured(xml_content, screenshot):
    """UI捕获完成后的回调函数"""
    try:
        # 解析XML
        root, node_data, tree_html = ui_capturer.parse_hierarchy(xml_content)
        
        # 转换截图为Base64
        if screenshot:
            buffered = io.BytesIO()
            screenshot.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
        else:
            img_str = None
        
        # 发送数据到前端
        socketio.emit('ui_data', {
            'nodes': node_data,
            'tree_html': tree_html,
            'screenshot': img_str,
            'timestamp': time.time()
        })
    except Exception as e:
        logger.error(f"处理UI捕获回调时出错: {str(e)}")
        socketio.emit('error', {'message': f"处理UI数据失败: {str(e)}"})

# 添加回调
ui_capturer.add_capture_callback(on_ui_captured)

# 路由定义
@app.route('/')
def index():
    """主页，显示UI查看器"""
    return render_template('viewer.html')

@app.route('/static/<path:path>')
def serve_static(path):
    """提供静态文件"""
    return send_from_directory('app/static', path)

@app.route('/api/devices')
def get_devices():
    """获取已连接的设备列表"""
    devices = device_manager.get_device_list()
    print('devices',devices)
    return jsonify({
        'devices': devices,
        'status': device_manager.get_status()
    })

@app.route('/api/connect/usb', methods=['POST'])
def connect_usb():
    """通过USB连接设备"""
    data = request.json
    serial = data.get('serial')
    result = device_manager.connect_usb(serial)
    return jsonify({
        'success': result,
        'status': device_manager.get_status()
    })

@app.route('/api/disconnect', methods=['POST'])
def disconnect():
    """断开设备连接"""
    result = device_manager.disconnect()
    return jsonify({
        'success': result,
        'status': device_manager.get_status()
    })

@app.route('/api/device/wakeup', methods=['POST'])
def wakeup_device():
    """唤醒设备屏幕"""
    if not device_manager.connected:
        return jsonify({'success': False, 'error': '设备未连接'}), 400
    success, message = device_manager.wakeup_screen()
    if success:
        return jsonify({'success': True, 'message': message})
    else:
        return jsonify({'success': False, 'error': message}), 500

@app.route('/api/capture', methods=['POST'])
def capture():
    """手动捕获UI"""
    result = ui_capturer.capture_once()
    
    if result:
        # 解析UI层次结构
        root, node_data, tree_html = ui_capturer.parse_hierarchy()
        
        # 准备截图数据
        screenshot_url = None
        if ui_capturer.last_screenshot:
            screenshot_url = '/api/screenshot'
        
        return jsonify({
            'success': True,
            'node_data': node_data,
            'tree_html': tree_html,
            'screenshot_url': screenshot_url,
            'timestamp': ui_capturer.last_capture_time
        })
    else:
        return jsonify({
            'success': False,
            'error': device_manager.error_message or "捕获失败"
        })

@app.route('/api/auto_capture/start', methods=['POST'])
def start_auto_capture():
    """开始自动捕获"""
    data = request.json
    interval = data.get('interval', 3)
    result = ui_capturer.start_auto_capture(interval)
    return jsonify({
        'success': result,
        'status': ui_capturer.get_capture_status()
    })

@app.route('/api/auto_capture/stop', methods=['POST'])
def stop_auto_capture():
    """停止自动捕获"""
    result = ui_capturer.stop_auto_capture()
    return jsonify({
        'success': result,
        'status': ui_capturer.get_capture_status()
    })

@app.route('/api/save', methods=['POST'])
def save_capture():
    """保存当前捕获的UI"""
    data = request.json
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # 确定保存路径
    save_dir = data.get('directory', os.getcwd())
    xml_filename = data.get('xml_filename', f'ui_hierarchy_{timestamp}.xml')
    img_filename = data.get('img_filename', f'screenshot_{timestamp}.png')
    
    xml_path = os.path.join(save_dir, xml_filename)
    img_path = os.path.join(save_dir, img_filename)
    
    result = ui_capturer.save_last_capture(xml_path, img_path)
    
    return jsonify({
        'success': result,
        'xml_path': xml_path if result else None,
        'img_path': img_path if result and ui_capturer.last_screenshot else None
    })

@app.route('/api/screenshot')
def get_screenshot():
    """获取最新的屏幕截图"""
    if not ui_capturer.last_screenshot:
        return jsonify({'error': '没有可用的屏幕截图'}), 404
    
    # 将截图转换为字节流
    img_io = io.BytesIO()
    ui_capturer.last_screenshot.save(img_io, 'PNG')
    img_io.seek(0)
    
    return send_file(img_io, mimetype='image/png', download_name='screenshot.png')

@app.route('/api/status')
def get_status():
    """获取当前状态"""
    return jsonify({
        'device': device_manager.get_status(),
        'capture': ui_capturer.get_capture_status()
    })

# SocketIO事件处理
@socketio.on('connect')
def handle_connect():
    """客户端连接事件"""
    logger.info(f"客户端连接: {request.sid}")
    emit('connection_status', device_manager.get_status())

@socketio.on('disconnect')
def handle_disconnect():
    """客户端断开连接事件"""
    logger.info(f"客户端断开连接: {request.sid}")

@socketio.on('get_device_list')
def handle_get_device_list():
    """获取设备列表"""
    try:
        devices = device_manager.get_device_list()
        emit('device_list', {'devices': devices})
    except Exception as e:
        logger.error(f"获取设备列表失败: {str(e)}")
        emit('error', {'message': f"获取设备列表失败: {str(e)}"})

@socketio.on('connect_usb')
def handle_connect_usb(data):
    """连接USB设备"""
    try:
        serial = data.get('serial')
        if not serial:
            emit('error', {'message': "未提供设备序列号"})
            return
        
        success = device_manager.connect_usb(serial)
        emit('connection_status', device_manager.get_status())
        
        if success:
            # 捕获一次UI以便立即显示
            ui_capturer.capture_once()
    except Exception as e:
        logger.error(f"连接USB设备失败: {str(e)}")
        emit('error', {'message': f"连接USB设备失败: {str(e)}"})

@socketio.on('disconnect_device')
def handle_disconnect_device():
    """断开设备连接"""
    try:
        # 停止自动捕获
        if ui_capturer.auto_capture_enabled:
            ui_capturer.stop_auto_capture()
        
        # 断开设备
        success = device_manager.disconnect()
        emit('connection_status', device_manager.get_status())
    except Exception as e:
        logger.error(f"断开设备连接失败: {str(e)}")
        emit('error', {'message': f"断开设备连接失败: {str(e)}"})

@socketio.on('capture_once')
def handle_capture_once():
    """执行一次UI捕获"""
    try:
        if not device_manager.connected:
            emit('error', {'message': "未连接设备，无法捕获UI"})
            return
        
        success = ui_capturer.capture_once()
        emit('capture_status', ui_capturer.get_capture_status())
    except Exception as e:
        logger.error(f"UI捕获失败: {str(e)}")
        emit('error', {'message': f"UI捕获失败: {str(e)}"})

@socketio.on('start_auto_capture')
def handle_start_auto_capture(data):
    """开始自动捕获"""
    try:
        interval = data.get('interval', 3)
        success = ui_capturer.start_auto_capture(interval)
        emit('capture_status', ui_capturer.get_capture_status())
    except Exception as e:
        logger.error(f"启动自动捕获失败: {str(e)}")
        emit('error', {'message': f"启动自动捕获失败: {str(e)}"})

@socketio.on('stop_auto_capture')
def handle_stop_auto_capture():
    """停止自动捕获"""
    try:
        success = ui_capturer.stop_auto_capture()
        emit('capture_status', ui_capturer.get_capture_status())
    except Exception as e:
        logger.error(f"停止自动捕获失败: {str(e)}")
        emit('error', {'message': f"停止自动捕获失败: {str(e)}"})

@socketio.on('save_capture')
def handle_save_capture(data):
    """保存捕获结果"""
    try:
        xml_path = data.get('xml_path', 'capture.xml')
        img_path = data.get('img_path', 'capture.png')
        
        success = ui_capturer.save_last_capture(xml_path, img_path)
        if success:
            emit('save_result', {'success': True, 'message': f"已保存至 {xml_path} 和 {img_path}"})
        else:
            emit('save_result', {'success': False, 'message': "保存失败"})
    except Exception as e:
        logger.error(f"保存捕获结果失败: {str(e)}")
        emit('error', {'message': f"保存捕获结果失败: {str(e)}"})

# 主函数
if __name__ == '__main__':
    try:
        # 显示启动信息
        logger.info("XML Viewer Web服务已启动")
        logger.info("请在浏览器中访问: http://127.0.0.1:5000")
        
        # 启动Flask应用
        socketio.run(app, host='0.0.0.0', port=5000, debug=True)
    except KeyboardInterrupt:
        logger.info("程序被用户中断")
        sys.exit(0)
    except Exception as e:
        logger.error(f"程序发生错误: {str(e)}")
        sys.exit(1) 