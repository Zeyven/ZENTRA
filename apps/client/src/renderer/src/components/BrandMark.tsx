import logo from '../assets/thera-jade.svg'
import {BRAND_NAME} from '../../../shared/brand'

export default function BrandMark({className = 'h-10 w-10'}: {className?: string}) {
  return <img src={logo} alt={`${BRAND_NAME} 标志`} className={`shrink-0 ${className}`} width={40} height={40}/>
}
