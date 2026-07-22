import { Navigate, useParams } from "react-router-dom";
import JourneyEntryView from "../components/journey/JourneyEntryView";
import { journeyEntries } from "../data/journey";

export default function JourneyEntryPage() {
  const { slug } = useParams<{ slug: string }>();
  const entry = journeyEntries.find((e) => e.slug === slug);

  if (!entry) {
    return <Navigate to="/journey" replace />;
  }

  return (
    <section className="section">
      <div className="container">
        <JourneyEntryView entry={entry} />
      </div>
    </section>
  );
}
