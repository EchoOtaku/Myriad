-- 虚拟人物设定表（支持多人设槽位）
CREATE TABLE IF NOT EXISTS virtual_persona (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL DEFAULT 'default_user',
    slot INTEGER NOT NULL DEFAULT 0, -- 槽位号（0或1）
    name VARCHAR(255) NOT NULL,
    personality TEXT NOT NULL,
    appearance TEXT NOT NULL,
    hobbies JSONB NOT NULL DEFAULT '[]',
    life_style TEXT NOT NULL,
    visual_style TEXT,
    image_prompt TEXT NOT NULL,
    image_url TEXT,
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, slot)
);

CREATE INDEX idx_virtual_persona_user_id ON virtual_persona(user_id);

COMMENT ON TABLE virtual_persona IS '虚拟人物设定数据（支持最多2个槽位）';
COMMENT ON COLUMN virtual_persona.user_id IS '用户ID';
COMMENT ON COLUMN virtual_persona.slot IS '槽位号（0或1）';
COMMENT ON COLUMN virtual_persona.name IS '虚拟人物名字';
COMMENT ON COLUMN virtual_persona.personality IS '性格特征';
COMMENT ON COLUMN virtual_persona.appearance IS '外貌描述';
COMMENT ON COLUMN virtual_persona.hobbies IS '兴趣爱好数组';
COMMENT ON COLUMN virtual_persona.life_style IS '生活方式';
COMMENT ON COLUMN virtual_persona.visual_style IS '艺术风格定位（说明为什么选择这个风格）';
COMMENT ON COLUMN virtual_persona.image_prompt IS 'AI绘画提示词';
COMMENT ON COLUMN virtual_persona.image_url IS '生成的图片URL';
COMMENT ON COLUMN virtual_persona.generated_at IS '生成时间';
