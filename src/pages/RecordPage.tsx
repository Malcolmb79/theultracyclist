import RecordFacts from "../components/record/RecordFacts";
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
        <RecordFacts />
      </div>
    </section>
  );
}
