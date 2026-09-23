import Link from 'next/link';
export default function NotFound() {
  return (
    <section className="page-intro container">
      <span className="eyebrow">PAGE NOT FOUND</span>
      <h1>
        A different place
        <br />
        to get your work done.
      </h1>
      <p>Chat, Work, Build, and projects belong in AYRA Desktop.</p>
      <Link href="/download" className="ay-button ay-button--primary">
        Explore AYRA Desktop
      </Link>
    </section>
  );
}
