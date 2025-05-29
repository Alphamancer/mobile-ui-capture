#!/usr/bin/env python
# -*- coding: utf-8 -*-

import logging
from typing import List, Dict, Any

logger = logging.getLogger('XmlViewer.Modules')

class DeviceManager:
    """设备管理器，负责管理与Android设备的连接"""
    
    def __init__(self):
        """初始化设备管理器"""
        self.device = None
        self.connection_type = None
        self.device_serial = None
        self.error_message = None
        self.connected = False
    
    def get_device_list(self) -> List[Dict[str, str]]:
        """获取已连接的设备列表"""
        try:
            import uiautomator2 as u2
            import adbutils
            
            devices = []
            # 使用adbutils.adb.device_list()获取设备列表
            for device in adbutils.adb.device_list():
                devices.append({
                    'serial': device.serial,
                    'type': 'USB'
                })
            
            return devices
        except Exception as e:
            logger.error(f"获取设备列表失败: {str(e)}")
            self.error_message = str(e)
            return []
    
    def connect_usb(self, serial: str) -> bool:
        """通过USB连接设备"""
        try:
            import uiautomator2 as u2
            self.device = u2.connect(serial)
            self.connection_type = 'usb'
            self.device_serial = serial
            self.connected = True
            self.error_message = None
            logger.info(f"已连接USB设备: {serial}")
            return True
        except Exception as e:
            logger.error(f"连接USB设备失败: {str(e)}")
            self.error_message = str(e)
            self.connected = False
            return False
    
    def disconnect(self) -> bool:
        """断开设备连接"""
        try:
            self.device = None
            self.connected = False
            logger.info("已断开设备连接")
            return True
        except Exception as e:
            logger.error(f"断开设备连接失败: {str(e)}")
            self.error_message = str(e)
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """获取当前连接状态"""
        return {
            'connected': self.connected,
            'connection_type': self.connection_type,
            'device_serial': self.device_serial,
            'error': self.error_message
        }

    def wakeup_screen(self) -> tuple[bool, str]:
        """唤醒设备屏幕"""
        if not self.connected or not self.device:
            return False, "设备未连接"
        
        try:
            self.device.screen_on()
            # 有些设备可能需要解锁
            # self.device.unlock() # 如果需要自动解锁，取消此行注释
            logger.info(f"设备 {self.device_serial} 屏幕已唤醒")
            return True, "屏幕已唤醒"
        except Exception as e:
            logger.error(f"唤醒屏幕失败: {str(e)}")
            return False, f"唤醒屏幕失败: {str(e)}"