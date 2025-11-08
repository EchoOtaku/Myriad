export default function LibraryGridSkeleton() {
    return (
        <div className="space-y-8">
            {/* 筛选器骨架 */}
            <div className="flex justify-center mb-6 animate-pulse">
                <div className="glass rounded-xl p-1.5 inline-flex gap-1.5">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-10 w-24 bg-gray-200 rounded-lg"></div>
                    ))}
                </div>
            </div>

            {/* 网格骨架 - 响应式grid布局模拟瀑布流 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 auto-rows-fr">
                {/* 音乐卡片 - 正方形 */}
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                
                {/* 游戏卡片 - 横跨2列 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl animate-pulse"></div>
                
                {/* 音乐卡片 */}
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                
                {/* 视频卡片 - 横跨2列 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl animate-pulse"></div>
                
                {/* 游戏卡片 - 横跨2列 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl animate-pulse"></div>
                
                {/* 音乐卡片 */}
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                
                {/* 音乐卡片 */}
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                <div className="aspect-square bg-gray-200 rounded-xl animate-pulse"></div>
                
                {/* 视频卡片 - 横跨2列 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl animate-pulse"></div>
            </div>
        </div>
    );
}
