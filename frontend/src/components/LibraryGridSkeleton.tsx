export default function LibraryGridSkeleton() {
    return (
        <div className="space-y-8 animate-pulse">
            {/* 筛选器骨架 */}
            <div className="flex justify-center mb-6">
                <div className="glass rounded-xl p-1.5 inline-flex gap-1.5">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-10 w-24 bg-gray-200 rounded-lg"></div>
                    ))}
                </div>
            </div>

            {/* 网格骨架 - 模拟瀑布流布局 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                {/* 音乐卡片 - 1列宽 */}
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                
                {/* 游戏/视频卡片 - 2列宽 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl"></div>
                
                {/* 音乐卡片 */}
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                
                {/* 视频卡片 - 2列宽 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl"></div>
                
                {/* 音乐卡片 */}
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                
                {/* 游戏卡片 - 2列宽 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl"></div>
                
                {/* 音乐卡片 */}
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                <div className="aspect-square bg-gray-200 rounded-xl"></div>
                
                {/* 视频卡片 - 2列宽 */}
                <div className="col-span-2 aspect-[2/1] bg-gray-200 rounded-2xl"></div>
            </div>
        </div>
    );
}
