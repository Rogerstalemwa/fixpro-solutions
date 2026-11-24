import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <h1 className="text-3xl font-bold">We could not find that page</h1>
      <p className="mt-3 text-mist">Check the address, or go back to the home page.</p>
      <Link to="/" className="btn-primary mt-6">Go to home</Link>
    </section>
  );
}
