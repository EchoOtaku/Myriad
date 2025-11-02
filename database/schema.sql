-- Myriad Database Schema
-- PostgreSQL 16+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Platforms table: Store supported platforms configuration
CREATE TABLE platforms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    icon VARCHAR(50),
    api_endpoint VARCHAR(255),
    auth_type VARCHAR(50), -- 'oauth', 'token', 'api_key'
    enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User profiles table: Store fetched user profile data from different platforms
CREATE TABLE user_profiles (
    id SERIAL PRIMARY KEY,
    platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    avatar_url TEXT,
    bio TEXT,
    location VARCHAR(255),
    website VARCHAR(255),
    raw_data JSONB NOT NULL, -- Store complete API response
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform_id, username)
);

-- User activities table: Store user activities and posts from platforms
CREATE TABLE user_activities (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL, -- 'post', 'commit', 'tweet', 'article', etc.
    title TEXT,
    content TEXT,
    url TEXT,
    metadata JSONB, -- Store additional data like likes, comments, stars, etc.
    activity_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Analysis results table: Store AI analysis results
CREATE TABLE analysis_results (
    id SERIAL PRIMARY KEY,
    analysis_type VARCHAR(100) NOT NULL, -- 'profile_summary', 'skill_extraction', 'personality_analysis', etc.
    input_profiles JSONB NOT NULL, -- Array of profile IDs or data used for analysis
    result JSONB NOT NULL, -- Analysis output
    ai_model VARCHAR(100) NOT NULL, -- 'gpt-4', 'claude-3', etc.
    tokens_used INTEGER,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Configurations table: Store system and user configurations
CREATE TABLE configurations (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false, -- Whether to expose in frontend
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- API keys table: Store encrypted API keys and tokens
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    platform_id INTEGER REFERENCES platforms(id) ON DELETE CASCADE,
    service_name VARCHAR(100) NOT NULL, -- 'github', 'openai', 'twitter', etc.
    key_encrypted TEXT NOT NULL, -- Encrypted API key
    key_hint VARCHAR(50), -- Last 4 characters or hint
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Fetch jobs table: Track data fetching jobs
CREATE TABLE fetch_jobs (
    id SERIAL PRIMARY KEY,
    platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL, -- 'pending', 'running', 'completed', 'failed'
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    items_fetched INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_user_profiles_platform_id ON user_profiles(platform_id);
CREATE INDEX idx_user_profiles_username ON user_profiles(username);
CREATE INDEX idx_user_activities_profile_id ON user_activities(profile_id);
CREATE INDEX idx_user_activities_timestamp ON user_activities(activity_timestamp DESC);
CREATE INDEX idx_analysis_results_type ON analysis_results(analysis_type);
CREATE INDEX idx_fetch_jobs_status ON fetch_jobs(status);
CREATE INDEX idx_fetch_jobs_platform_id ON fetch_jobs(platform_id);

-- Insert default platforms
INSERT INTO platforms (name, display_name, icon, api_endpoint, auth_type, enabled) VALUES
    ('github', 'GitHub', 'github', 'https://api.github.com', 'token', true),
    ('twitter', 'Twitter/X', 'twitter', 'https://api.twitter.com/2', 'bearer_token', false),
    ('linkedin', 'LinkedIn', 'linkedin', 'https://api.linkedin.com/v2', 'oauth', false),
    ('reddit', 'Reddit', 'reddit', 'https://oauth.reddit.com', 'oauth', false),
    ('dev.to', 'Dev.to', 'dev', 'https://dev.to/api', 'api_key', false);

-- Insert default configurations
INSERT INTO configurations (key, value, description, is_public) VALUES
    ('auto_fetch_enabled', 'false', 'Enable automatic data fetching', true),
    ('fetch_interval_hours', '24', 'Interval between automatic fetches in hours', true),
    ('ai_provider', '"openai"', 'AI service provider (openai, anthropic)', true),
    ('ai_model', '"gpt-4"', 'AI model to use for analysis', true),
    ('theme', '"light"', 'UI theme preference', true);
