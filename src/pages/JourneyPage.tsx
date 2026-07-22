import JourneyList from "../components/journey/JourneyList";
import SectionHeading from "../components/shared/SectionHeading";
import { journeyEntries } from "../data/journey";

export default function JourneyPage() {
  return (
    <section className="section">
      <div className="container">
        <SectionHeading eyebrow="The journey" title="Training, prep, and updates" />
        <JourneyList entries={journeyEntries} />
      </div>
    </section>
  );
}
