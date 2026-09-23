import Link from 'next/link';
import { FoundationView, surfaces, type Surface } from '@ayra/ui';
export function View({ surface }: { surface: Surface }) {
  return (
    <FoundationView
      surface={surface}
      secondaryNavigation={
        <Link href="/settings" aria-current={surface === 'Settings' ? 'page' : undefined}>
          Settings
        </Link>
      }
      navigation={surfaces
        .filter((item) => item !== 'Settings')
        .map((item) => (
          <Link
            key={item}
            href={item === 'Home' ? '/' : `/${item.toLowerCase()}`}
            aria-current={surface === item ? 'page' : undefined}
          >
            {item}
          </Link>
        ))}
    />
  );
}
