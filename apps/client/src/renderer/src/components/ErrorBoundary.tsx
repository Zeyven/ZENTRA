import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// 全局错误边界：任何渲染异常不整页白屏，显示错误详情（便于定位/反馈）
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[ErrorBoundary]', error, info)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center bg-[#f5f7f9] p-8">
          <div className="max-w-lg w-full bg-white rounded-2xl border border-red-200 shadow-lg p-6 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">页面出现异常</h2>
            <div className="text-xs text-red-600 bg-red-50 rounded-lg p-3 mb-4 break-all text-left font-mono">
              {this.state.error.message || String(this.state.error)}
            </div>
            <div className="text-xs text-gray-400 mb-4">
              请把上方红色错误信息复制发给管理员，可快速定位修复。
            </div>
            <div className="flex gap-2 justify-center">
              <button
                className="btn-secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(this.state.error?.message || '')
                }}
              >
                复制错误
              </button>
              <button className="btn-primary" onClick={this.reset}>
                重新加载页面
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
