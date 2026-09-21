import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useToast, toast } from '../store/toast'
import Icon from './Icon'
import {assertActionResult} from '../utils/action-result'

const dialogStack: HTMLElement[] = []
function syncDialogLayers() {
  dialogStack.forEach((panel,index)=>{
    const layer=panel.closest<HTMLElement>('.dialog-backdrop')!
    const top=index===dialogStack.length-1
    layer.style.zIndex=String(6000+index*10)
    layer.inert=!top
    panel.setAttribute('aria-modal',String(top))
  })
}
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function AsyncButton({ onClick, children, disabled, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onClick: (event: MouseEvent<HTMLButtonElement>) => unknown | Promise<unknown>
}): JSX.Element {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  return <button type="button" {...props} disabled={disabled || busy} aria-busy={busy} onClick={async event => {
    if (running.current) return
    running.current = true; setBusy(true)
    try { assertActionResult(await onClick(event)) }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) toast(error instanceof Error ? error.message : '操作结果未确认，请刷新核对', 'error') }
    finally { running.current = false; setBusy(false) }
  }}>{busy ? '处理中…' : children}</button>
}

function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useLayoutEffect(() => {
    const panel = ref.current
    if (!open || !panel) return
    const previous = document.activeElement as HTMLElement | null
    dialogStack.push(panel)
    syncDialogLayers()
    panel.focus()
    const onKey = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== panel) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRef.current()
      } else if (event.key === 'Tab') {
        const controls = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(el => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true')
        const first = controls[0], last = controls.at(-1)
        if (!first) { event.preventDefault(); panel.focus(); return }
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (active === last || active === panel || !panel.contains(active))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const wasTop = dialogStack.at(-1) === panel
      const index = dialogStack.indexOf(panel)
      if (index >= 0) dialogStack.splice(index, 1)
      syncDialogLayers()
      if (wasTop) {
        const top=dialogStack.at(-1)
        if (previous?.isConnected && (!top || top.contains(previous))) previous.focus()
        else top?.focus()
      }
    }
  }, [open])
  return ref
}

// Legacy custom layouts participate in the same portal, focus and opening-order stack.
export function DialogLayer({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useDialogFocus(true,onClose)
  return createPortal(<div className="dialog-backdrop fixed inset-0 flex items-center justify-center" onMouseDown={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="max-w-full max-h-full outline-none" onMouseDown={event=>event.stopPropagation()}>{children}</div>
  </div>,document.body)
}

export function Toaster(): JSX.Element {
  const { toasts, remove } = useToast()
  const current = toasts[0]
  useEffect(() => {
    // Count the display duration, not time spent waiting behind another notice.
    if (!current || current.type === 'error') return
    const timer = window.setTimeout(() => remove(current.id), 2600)
    return () => window.clearTimeout(timer)
  }, [current?.id, remove])
  if (!current) return <></>
  return (
    <div className="notification-popover" aria-label="操作通知">
      {toasts.slice(0, 1).map((t) => (
        <div
          key={t.id}
          role={t.type === 'error' ? 'alert' : 'status'}
          className={`toast-message text-sm text-white flex items-center gap-2 ${
            t.type === 'success' ? 'bg-emerald-700' : t.type === 'error' ? 'bg-red-600' : 'bg-gray-700'
          }`}
        >
          <span className="notification-text">{t.msg}</span>
          {toasts.length > 1 && <span className="shrink-0 text-xs">另 {toasts.length - 1} 条</span>}
          <button type="button" aria-label="关闭通知" className="p-1 opacity-80 hover:opacity-100" onClick={() => remove(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

export function Modal(props: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
  footer?: ReactNode
  role?: 'dialog' | 'alertdialog'
}): JSX.Element | null {
  const { open, title, onClose, children, width = 'max-w-lg', footer } = props
  const titleId = useId()
  const panelRef = useDialogFocus(open, onClose)

  if (!open) return null
  return createPortal(
    <div className="dialog-backdrop fixed inset-0 flex items-center justify-center" onMouseDown={onClose}>
      <div
        ref={panelRef} tabIndex={-1}
        role={props.role || 'dialog'} aria-modal="true" aria-labelledby={titleId}
        className={`dialog-panel bg-white w-full ${width} max-h-[85vh] flex flex-col outline-none`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h3 id={titleId} className="text-base font-semibold text-gray-800">{title}</h3>
          <button type="button" aria-label={`关闭${title}`} className="dialog-close text-base leading-none" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>, document.body
  )
}

export function Confirm(props: {
  open: boolean
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  danger?: boolean
}): JSX.Element | null {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const cancel = (): void => { if (!running.current) props.onCancel() }
  const confirm = async (): Promise<void> => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try { await props.onConfirm() }
    catch (error) { if (!(error instanceof DOMException && error.name==='AbortError')) toast(error instanceof Error ? error.message : '操作结果未确认，请刷新核对', 'error') }
    finally { running.current = false; setBusy(false) }
  }
  return (
    <Modal open={props.open} title={props.title} onClose={cancel} width="max-w-sm" role="alertdialog" footer={
        <>
          <button type="button" className="btn-secondary" disabled={busy} onClick={cancel}>
            取消
          </button>
          <button type="button" disabled={busy} aria-busy={busy} className={props.danger ? 'btn-danger' : 'btn-primary'} onClick={() => void confirm()}>
            {busy ? '处理中…' : '确定'}
          </button>
        </>
    }><p className="text-sm leading-relaxed text-gray-600">{props.message}</p></Modal>
  )
}

export function EmptyState(props: { text?: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <div className="empty-state-icon"><Icon name="items" size={25}/></div>
      <div className="text-sm">{props.text || '暂无数据'}</div>
    </div>
  )
}

export function StatCard(props: { label: string; value: string; sub?: string; accent?: string }): JSX.Element {
  return (
    <div className="card stat-card">
      <div className="text-xs text-gray-500 mb-1">{props.label}</div>
      <div className={`stat-card-value ${props.accent || 'text-gray-800'}`}>{props.value}</div>
      {props.sub && <div className="text-xs text-gray-400 mt-1">{props.sub}</div>}
    </div>
  )
}

export function Badge(props: { text: string; className?: string }): JSX.Element {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${props.className || 'bg-gray-100 text-gray-600'}`}>
      {props.text}
    </span>
  )
}
