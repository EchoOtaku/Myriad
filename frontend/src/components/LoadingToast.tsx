import { useEffect, useState } from 'react';

interface LoadingToastProps {
    message?: string;
    show: boolean;
}

export default function LoadingToast({ message = '加载中...', show }: LoadingToastProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (show) {
            setVisible(true);
        } else {
            const timer = setTimeout(() => setVisible(false), 300);
            return () => clearTimeout(timer);
        }
    }, [show]);

    if (!visible) return null;

    return (
        <div 
            className={`fixed bottom-8 left-8 z-50 transition-all duration-300 ${
                show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
        >
            <div className="glass rounded-2xl px-6 py-4 shadow-2xl border border-white/60 flex items-center gap-3 backdrop-blur-xl">
                {/* 加载动画 */}
                <div className="animate-spin rounded-full w-5 h-5 border-2 border-white/30" style={{ borderTopColor: 'var(--color-primary)' }}></div>
                
                {/* 加载文字 */}
                <span className="text-sm font-medium text-gray-700">
                    {message}
                </span>
            </div>
        </div>
    );
}
