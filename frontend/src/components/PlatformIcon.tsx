import React from 'react';
import { FaGithub, FaSteam } from 'react-icons/fa';
import { SiBilibili } from 'react-icons/si';
import { FaXTwitter } from 'react-icons/fa6';

interface PlatformIconProps {
    platform: string;
    className?: string;
}

const PlatformIcon: React.FC<PlatformIconProps> = ({ platform, className = "w-6 h-6" }) => {
    switch (platform.toLowerCase()) {
        case 'github':
            return <FaGithub className={className} />;
        case 'bilibili':
            return <SiBilibili className={className} />;
        case 'steam':
            return <FaSteam className={className} />;
        case 'twitter':
        case 'x':
            return <FaXTwitter className={className} />;
        default:
            return <span className={className}>?</span>;
    }
};

export default PlatformIcon;
