export default function ReportCardsSkeleton() {
    return (
        <div className="max-w-6xl mx-auto px-4 py-8 animate-pulse">
            {/* 报告信息条骨架 */}
            <div className="mb-6 glass rounded-3xl p-5 border shadow-lg">
                <div className="flex items-center justify-between gap-6">
                    {/* 左侧：用户信息骨架 */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gray-200"></div>
                        <div>
                            <div className="h-5 w-24 bg-gray-200 rounded mb-2"></div>
                            <div className="h-3 w-32 bg-gray-200 rounded"></div>
                        </div>
                    </div>
                    
                    {/* 中间：社交链接骨架 */}
                    <div className="flex-1 max-w-sm">
                        <div className="flex flex-wrap gap-2">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-8 w-20 bg-gray-200 rounded-xl"></div>
                            ))}
                        </div>
                    </div>

                    {/* 右侧：报告信息骨架 */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-200"></div>
                            <div>
                                <div className="h-4 w-20 bg-gray-200 rounded mb-2"></div>
                                <div className="h-3 w-32 bg-gray-200 rounded"></div>
                            </div>
                        </div>
                        <div className="h-12 w-24 bg-gray-200 rounded-2xl"></div>
                    </div>
                </div>
            </div>

            {/* 卡片网格骨架 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="glass rounded-3xl p-6 border" style={{ animationDelay: `${i * 0.1}s` }}>
                        {/* 卡片头部 */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 rounded-2xl bg-gray-200"></div>
                            <div className="w-8 h-8 rounded-full bg-gray-200"></div>
                        </div>

                        {/* 标题 */}
                        <div className="h-4 w-20 bg-gray-200 rounded mb-3"></div>

                        {/* 摘要 */}
                        <div className="space-y-2 mb-4">
                            <div className="h-5 bg-gray-200 rounded"></div>
                            <div className="h-5 bg-gray-200 rounded w-4/5"></div>
                        </div>

                        {/* 标签 */}
                        <div className="flex gap-2">
                            <div className="h-6 w-16 bg-gray-200 rounded-full"></div>
                            <div className="h-6 w-20 bg-gray-200 rounded-full"></div>
                        </div>
                    </div>
                ))}
            </div>

            {/* 底部提示 */}
            <div className="mt-8 text-center">
                <div className="h-4 w-64 bg-gray-200 rounded mx-auto mb-2"></div>
                <div className="h-4 w-48 bg-gray-200 rounded mx-auto"></div>
            </div>
        </div>
    );
}
