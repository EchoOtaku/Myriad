import './Skeleton.css';

export default function ReportCardsSkeleton() {
    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            {/* 报告信息条骨架 - 完全匹配实际结构 */}
            <div className="mb-6 glass rounded-3xl p-5 border shadow-lg report-info-card relative animate-pulse">
                <div className="flex items-center justify-between gap-6">
                    {/* 左侧区域1：用户信息骨架 */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gray-200 shadow-md"></div>
                        <div>
                            <div className="h-[22px] w-24 bg-gray-200 rounded mb-1"></div>
                            <div className="h-3 w-32 bg-gray-200 rounded"></div>
                        </div>
                    </div>
                    
                    {/* 中间区域2：社交链接骨架 */}
                    <div className="flex-1 max-w-sm">
                        <div className="flex flex-wrap gap-2">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-[30px] w-20 bg-gray-200 rounded-xl"></div>
                            ))}
                        </div>
                    </div>

                    {/* 右侧区域3：报告信息骨架 */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-200"></div>
                            <div>
                                <div className="h-[18px] w-20 bg-gray-200 rounded mb-1"></div>
                                <div className="h-3 w-32 bg-gray-200 rounded"></div>
                            </div>
                        </div>
                        <div className="h-12 w-24 bg-gray-200 rounded-2xl shadow-md"></div>
                        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-200 shadow-md"></div>
                    </div>
                </div>
            </div>

            {/* 卡片网格骨架 - 100%精确匹配实际卡片（包括所有过渡和阴影） */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-all duration-500 ease-out opacity-100 scale-100">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <article 
                        key={i} 
                        className="glass rounded-3xl p-6 hover:shadow-2xl transition-all duration-300 border report-card cursor-pointer hover:scale-[1.02] active:scale-[0.98] group animate-pulse"
                        style={{
                            animationDelay: `${i * 0.05}s`
                        }}
                    >
                        {/* 头部区域：图标 + 箭头按钮（与实际完全一致，按钮存在但透明） */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 rounded-2xl bg-gray-200 shadow-lg"></div>
                            {/* 箭头按钮骨架 - 透明但占据空间 */}
                            <button
                                className="text-gray-400 hover:text-gray-600 transition-all duration-200 p-2 rounded-full hover:bg-gray-100 active:scale-90 opacity-0 group-hover:opacity-100"
                                aria-label="查看详情"
                                disabled
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>

                        {/* 小标题 - text-sm，单行，较短文本 */}
                        <div className="h-5 w-32 bg-gray-200/70 rounded mb-2"></div>

                        {/* 主摘要 - text-xl font-bold，2行截断，长文本会换行撑满 */}
                        <div className="mb-3">
                            <div className="h-7 w-full bg-gray-200 rounded mb-1"></div>
                            <div className="h-7 w-4/5 bg-gray-200 rounded"></div>
                        </div>

                        {/* 标签组 - 匹配实际标签样式 */}
                        <div className="flex flex-wrap gap-2">
                            <div className="h-[26px] w-16 bg-gray-200 rounded-full"></div>
                            <div className="h-[26px] w-20 bg-gray-200 rounded-full"></div>
                            {/* 随机显示2-3个标签 */}
                            {i % 3 === 0 && <div className="h-[26px] w-14 bg-gray-200 rounded-full"></div>}
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );
}
