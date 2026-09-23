import type { ComponentPropsWithRef, HTMLAttributes, ReactNode } from 'react';
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button className={`ay-button ay-button--${variant} ${className}`} {...props} />;
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ay-card ${className}`} {...props} />;
}
export function Navigation({
  children,
  label = 'Navigation',
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="ay-navigation">
      {children}
    </nav>
  );
}
export function Sidebar({ children }: { children: ReactNode }) {
  return <aside className="sidebar">{children}</aside>;
}
export function ArtifactCard({
  title,
  kind,
  children,
}: {
  title: string;
  kind: string;
  children?: ReactNode;
}) {
  return (
    <Card className="ay-object">
      <span className="ay-label">{kind}</span>
      <h3>{title}</h3>
      {children}
    </Card>
  );
}
export function TaskCard({
  title,
  status,
  children,
}: {
  title: string;
  status: string;
  children?: ReactNode;
}) {
  return (
    <Card className="ay-object">
      <span className="ay-label">{status}</span>
      <h3>{title}</h3>
      {children}
    </Card>
  );
}
export function ProjectCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Card className="ay-object">
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </Card>
  );
}
