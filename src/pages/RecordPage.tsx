import { Link } from "react-router-dom";
import RecordFacts from "../components/record/RecordFacts";
import RouteJourneyPoster from "../components/record/RouteJourneyPoster";
import SectionHeading from "../components/shared/SectionHeading";

export default function RecordPage() {
  return (
    <section className="section">
      <div className="container">
        <SectionHeading
          eyebrow="The record"
          title="Ireland, North to South"
          subtitle="An unsupported ride the length of Ireland, chasing a new benchmark for the route."
        />
        <RouteJourneyPoster />
        <RecordFacts />
        <p style={{ marginTop: "1.5rem" }}>
          Not the first record attempt — <Link to="/previous-record">see the 2022 East-to-West record &rarr;</Link>
        </p>
      </div>
    </section>
  );
}
