import type {CSSProperties} from 'react'

const paths = {
  board: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3 M9 7h6 M9 11h6 M9 15h3',
  technicians: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  clockroom: 'M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  items: 'm3 7 9-5 9 5v10l-9 5-9-5V7 m0 0 9 5 9-5 M12 12v10 M7.5 4.5l9 5',
  members: 'M3 5h18v14H3z M3 9h18 M6 14h4 M17 14h1',
  reservations: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2 M7 2v4 M17 2v4 M3 10h18 M8 14h2 M14 14h2',
  queue: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  reports: 'M3 3v18h18 M7 16v-5 M12 16V7 M17 16v-8',
  shift: 'M3 7h17l-4-4 M21 17H4l4 4 M20 7l-4 4 M4 17l4-4',
  settings: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6',
  headquarters: 'M3 21V7h7v14 M10 21V3h11v18 M1 21h22 M6 11h1 M6 15h1 M14 7h3 M14 11h3 M14 15h3',
  approvals: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4 M8 12l3 3 5-6',
  organization: 'M9 2h6v6H9z M2 16h6v6H2z M16 16h6v6h-6z M12 8v4 M5 16v-4h14v4',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M5.1 7a8 8 0 0 1 13.5-2L20 7 M4 17l1.4 2A8 8 0 0 0 19 17',
  search: 'M21 21l-5.2-5.2 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14',
  logout: 'M9 3H3v18h6 M8 12h13 M17 8l4 4-4 4',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3',
} as const
export type IconName = keyof typeof paths
export default function Icon({name,size=20,className,style}: {name:IconName;size?:number;className?:string;style?:CSSProperties}) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}><path d={paths[name]}/></svg>
}
