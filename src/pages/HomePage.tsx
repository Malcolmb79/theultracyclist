import { Link } from "react-router-dom";
import Hero from "../components/hero/Hero";
import FundraiserProgress from "../components/fundraiser/FundraiserProgress";
import JourneyList from "../components/journey/JourneyList";
import StravaEmbed from "../components/social/StravaEmbed";
import SectionHeading from "../components/shared/SectionHeading";
import { journeyEntries } from "../data/journey";

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="The cause"
            title="Every mile funds a heart surgery"
            subtitle="10,000 babies are born with a Congenital Heart Defect in South Africa every year — only 700 receive the surgery they need. This ride is raising money for The Maboneng Foundation to help change that."
          />
          <FundraiserProgress compact />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="The journey" title="Latest updates" />
          <JourneyList entries={journeyEntries} limit={3} />
          <p style={{ marginTop: "1.5rem" }}>
            <Link to="/journey">See all updates &rarr;</Link>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="On the bike" title="From Strava" />
          <StravaEmbed />
          <p style={{ marginTop: "1.5rem" }}>
            <Link to="/follow">More ways to follow &rarr;</Link>
          </p>
        </div>
      </section>
    </>
  );
}
