import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <section className="section">
      <div className="container">
        <h1>Page not found</h1>
        <p>
          <Link to="/">Back to home</Link>
        </p>
      </div>
    </section>
  );
}
