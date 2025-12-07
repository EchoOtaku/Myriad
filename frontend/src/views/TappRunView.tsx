/**
 * Tapp 运行视图包装器
 * 解析 URL 参数并传递给 TappRunPage
 */

import React from 'react'
import { useParams } from 'react-router-dom'
import { TappRunPage } from '../tapp/pages'

const TappRunView: React.FC = () => {
  // 从路由参数中获取 tappId
  const { id } = useParams<{ id: string }>()
  const tappId = id ? decodeURIComponent(id) : ''

  if (!tappId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">无效的 Tapp ID</p>
      </div>
    )
  }

  return <TappRunPage tappId={tappId} />
}

export default TappRunView
