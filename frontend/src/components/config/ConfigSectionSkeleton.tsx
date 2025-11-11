import React from 'react';
import '../Skeleton.css';

/**
 * 配置区块加载骨架屏
 * 在懒加载组件时提供更好的用户体验
 */
const ConfigSectionSkeleton: React.FC = () => {
  return (
    <div className="config-section">
      <div className="section-header">
        <div className="section-header-left">
          <div className="skeleton skeleton-icon" style={{ width: '2rem', height: '2rem', borderRadius: '0.5rem' }}></div>
          <div>
            <div className="skeleton skeleton-title" style={{ width: '150px', height: '1.5rem', marginBottom: '0.5rem' }}></div>
            <div className="skeleton skeleton-text" style={{ width: '250px', height: '1rem' }}></div>
          </div>
        </div>
      </div>

      <div className="config-form">
        {[1, 2, 3].map((i) => (
          <div key={i} className="form-group">
            <div className="skeleton skeleton-text" style={{ width: '120px', height: '1rem', marginBottom: '0.5rem' }}></div>
            <div className="skeleton skeleton-input" style={{ width: '100%', height: '2.5rem', borderRadius: '0.5rem' }}></div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConfigSectionSkeleton;
