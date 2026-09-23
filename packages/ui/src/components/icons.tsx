'use client';
import {
  ChatCircle,
  Briefcase,
  Code,
  Stack,
  FileText,
  Clock,
  ShieldCheck,
  Target,
  ArrowRight,
  Play,
  DownloadSimple,
  AppleLogo,
  WindowsLogo,
  CheckCircle,
  Lock,
  CaretRight,
} from '@phosphor-icons/react';
const icons = {
  chat: ChatCircle,
  work: Briefcase,
  build: Code,
  context: Stack,
  artifact: FileText,
  time: Clock,
  security: ShieldCheck,
  goal: Target,
  arrow: ArrowRight,
  play: Play,
  download: DownloadSimple,
  mac: AppleLogo,
  windows: WindowsLogo,
  check: CheckCircle,
  lock: Lock,
  chevron: CaretRight,
};
export function Icon({ name, size = 24 }: { name: keyof typeof icons; size?: number }) {
  const Component = icons[name];
  return <Component size={size} weight="regular" aria-hidden="true" />;
}
