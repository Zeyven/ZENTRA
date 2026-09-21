// Some API calls return a failure value rather than rejecting their promise.
// Shared action controls must not silently treat those values as success.
export function assertActionResult(result:unknown):void {
 if(!result||typeof result!=='object'||!('ok' in result)||result.ok!==false)return
 const value=result as {msg?:unknown;code?:unknown}
 const message=typeof value.msg==='string'&&value.msg.trim()?value.msg:'操作失败，请核对后重试'
 throw Object.assign(new Error(value.code==='RESULT_UNKNOWN'?`结果尚未确认：${message}。请核对原请求，不要重复创建操作。`:message),{code:value.code})
}
