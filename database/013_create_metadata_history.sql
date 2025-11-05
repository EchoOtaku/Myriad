-- 创建元数据变化历史表
CREATE TABLE IF NOT EXISTS metadata_history (
    id SERIAL PRIMARY KEY,
    metadata_id INTEGER NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    platform_name VARCHAR(100) NOT NULL,
    changed_fields JSONB NOT NULL,
    old_data JSONB,
    new_data JSONB NOT NULL,
    change_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_metadata_history_metadata_id 
        FOREIGN KEY (metadata_id) 
        REFERENCES platform_metadata(id) 
        ON DELETE CASCADE
);

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_metadata_history_metadata_id 
    ON metadata_history(metadata_id);

CREATE INDEX IF NOT EXISTS idx_metadata_history_user_platform 
    ON metadata_history(user_id, platform_name);

CREATE INDEX IF NOT EXISTS idx_metadata_history_change_date 
    ON metadata_history(change_date);

-- 添加注释
COMMENT ON TABLE metadata_history IS '元数据变化历史表，记录每次数据更新时的变化';
COMMENT ON COLUMN metadata_history.metadata_id IS '关联的元数据主表ID';
COMMENT ON COLUMN metadata_history.user_id IS '用户ID';
COMMENT ON COLUMN metadata_history.platform_name IS '平台名称';
COMMENT ON COLUMN metadata_history.changed_fields IS '发生变化的字段路径列表';
COMMENT ON COLUMN metadata_history.old_data IS '变化前的数据（首次插入时为NULL）';
COMMENT ON COLUMN metadata_history.new_data IS '变化后的数据';
COMMENT ON COLUMN metadata_history.change_date IS '变化发生的日期时间';
