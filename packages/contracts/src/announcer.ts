import {z} from 'zod';

// Configuration draft only. No vendor protocol or device delivery is implied.
export const AnnouncerDraft=z.object({
 protocol:z.enum(['unknown','tcp','udp','http','mqtt','serial']).default('unknown'),
 address:z.string().trim().max(253).regex(/^[A-Za-z0-9.:[\]_-]*$/,'只填写主机名、IP 或串口名，不填写 URL、密码或密钥').default(''),
 port:z.number().int().min(1).max(65535).nullable().default(null),
 terminal_id:z.string().trim().max(100).default(''),
 zone:z.string().trim().max(100).default('技师房'),
 template:z.string().trim().min(1).max(300).default('{technician_code}号技师，请到{room_no}房间上钟').refine(value=>!/[{}]/.test(value.replace(/\{(?:technician_code|room_no)\}/g,'')),'仅支持 {technician_code} 和 {room_no} 占位符'),
 repeats:z.number().int().min(1).max(3).default(1),
 volume:z.number().int().min(0).max(100).default(70),
 triggers:z.array(z.enum(['manual_call','assigned','reassigned'])).max(3).refine(values=>new Set(values).size===values.length,'触发方式不能重复').default(['manual_call'])
}).strict();
export type AnnouncerDraft=z.infer<typeof AnnouncerDraft>;
