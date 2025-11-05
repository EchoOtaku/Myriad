-- 创建平台元数据主表
CREATE TABLE IF NOT EXISTS platform_metadata (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL DEFAULT 'default_user',
    platform_name VARCHAR(100) NOT NULL,
    raw_data JSONB NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_platform_metadata_user_platform 
    ON platform_metadata(user_id, platform_name);

CREATE INDEX IF NOT EXISTS idx_platform_metadata_fetched_at 
    ON platform_metadata(fetched_at);

-- 添加注释
COMMENT ON TABLE platform_metadata IS '平台原始元数据主表，存储从各个平台API获取的完整数据';
COMMENT ON COLUMN platform_metadata.user_id IS '用户ID，标识数据所属用户';
COMMENT ON COLUMN platform_metadata.platform_name IS '平台名称，如 github, bilibili, steam, netease';
COMMENT ON COLUMN platform_metadata.raw_data IS '原始JSON数据，包含从平台API获取的完整信息';
COMMENT ON COLUMN platform_metadata.fetched_at IS '数据获取时间';
