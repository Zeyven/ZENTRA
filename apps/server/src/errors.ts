import type {ErrorRequestHandler} from 'express';
import {ZodError} from 'zod';
export class HttpError extends Error{
 constructor(public status:number,public code:string,message:string){super(message)}
}
export function ensure(value:unknown,status:number,code:string,message:string):asserts value{
 if(!value)throw new HttpError(status,code,message);
}
export const errorHandler:ErrorRequestHandler=(error,req,res,_next)=>{
 if(res.headersSent)return;
 // Body-parser failures are client input errors; never log raw parse messages or bodies.
 if(error?.type==='entity.parse.failed'&&error?.status===400){res.status(400).json({ok:false,code:'INVALID_JSON',message:'请求内容格式不正确，请刷新后重试。'});return}
 if(error?.type==='entity.too.large'&&error?.status===413){res.status(413).json({ok:false,code:'REQUEST_TOO_LARGE',message:'提交内容过大，请减少内容后重试。'});return}
 if(error instanceof ZodError){res.status(400).json({ok:false,code:'VALIDATION_FAILED',message:'输入格式不正确',details:error.issues.map(i=>({path:i.path,message:i.message}))});return}
 if(error instanceof HttpError){res.status(error.status).json({ok:false,code:error.code,message:error.message});return}
 const databaseErrors:Record<string,[number,string,string]>={
  '23505':[409,'ALREADY_EXISTS','记录已存在，请刷新后重试'],
  '23503':[409,'INVALID_REFERENCE','关联记录不存在或不属于当前商家'],
  '23514':[400,'INVALID_VALUE','数据不符合业务约束'],
  '42501':[403,'ACCESS_DENIED','没有访问权限'],
  '22023':[400,'INVALID_INVITATION','邀请无效、已使用或商家已停用'],
  '40001':[409,'CONCURRENT_UPDATE','记录已被其他终端修改，请刷新后重试'],
  '40P01':[409,'CONCURRENT_UPDATE','操作冲突，请刷新后重试']
 };
 const mapped=databaseErrors[error?.code];
 if(mapped){res.status(mapped[0]).json({ok:false,code:mapped[1],message:mapped[2]});return}
 console.error(JSON.stringify({event:'request.failed',request_id:res.locals.requestId,method:req.method,path:req.path,error:error?.name,code:error?.code,message:error?.message}));
 res.status(500).json({ok:false,code:'INTERNAL_ERROR',message:'服务处理失败，数据未提交。请联系管理员并提供请求编号。',request_id:res.locals.requestId});
};
