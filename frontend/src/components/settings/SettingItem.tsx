/**
 * 设置项工厂组件
 * 根据 type 自动选择渲染对应的设置项组件
 */

import React from 'react';
import type { SettingItemConfig, SettingType } from './types';
import { SwitchItem } from './items/SwitchItem';
import { InputItem } from './items/InputItem';
import { NumberItem } from './items/NumberItem';
import { SelectItem } from './items/SelectItem';
import { ProviderItem } from './items/ProviderItem';
import { ButtonItem } from './items/ButtonItem';
import { CheckboxItem } from './items/CheckboxItem';

export type { SettingItemConfig } from './types';

export const SettingItem: React.FC<SettingItemConfig> = (props) => {
  switch (props.type) {
    case 'switch':
      return <SwitchItem {...props} />;
    
    case 'checkbox':
      return <CheckboxItem {...props} />;
    
    case 'input':
      return <InputItem {...props} />;
    
    case 'number':
      return <NumberItem {...props} />;
    
    case 'select':
      return <SelectItem {...props} />;
    
    case 'provider':
      return <ProviderItem {...props} />;
    
    case 'button':
      return <ButtonItem {...props} />;
    
    case 'custom':
      return <>{props.render()}</>;
    
    case 'slider':
      // TODO: 实现 SliderItem
      console.warn('SliderItem not implemented yet');
      return null;
    
    default:
      const _exhaustive: never = props;
      return null;
  }
};

SettingItem.displayName = 'SettingItem';
