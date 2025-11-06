import React from 'react';
import { FaGithub, FaSteam, FaMusic } from 'react-icons/fa';
import { SiBilibili } from 'react-icons/si';
import { FaXTwitter } from 'react-icons/fa6';

interface PlatformIconProps {
    platform: string;
    className?: string;
    style?: React.CSSProperties;
}

const PlatformIcon: React.FC<PlatformIconProps> = ({ platform, className = "w-6 h-6", style }) => {
    switch (platform.toLowerCase()) {
        case 'github':
            return <FaGithub className={className} style={style} />;
        case 'bilibili':
            return <SiBilibili className={className} style={style} />;
        case 'steam':
            return <FaSteam className={className} style={style} />;
        case 'twitter':
        case 'x':
            return <FaXTwitter className={className} style={style} />;
        case 'netease music':
        case 'netease':
            return <FaMusic className={className} style={style || { color: '#d33a31' }} />;
        default:
            {/* @ts-ignore - Style prop needs to be passed through */}
            return <span className={className} style={style}>?</span>;
    }
};

export default PlatformIcon;
