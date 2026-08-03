import { Link } from "react-router-dom";
import Hero from "../components/hero/Hero";
import StorySection from "../components/home/StorySection";
import PathCards from "../components/home/PathCards";
import FundraiserProgress from "../components/fundraiser/FundraiserProgress";
import JourneyList from "../components/journey/JourneyList";
import StravaFeed from "../components/social/StravaFeed";
import SectionHeading from "../components/shared/SectionHeading";
import { journeyEntries } from "../data/journey";

export default function HomePage() {
  return (
    <>
      <Hero />

      {/* The story comes before the cause deliberately. The old page opened
          with the fundraising ask, which asks a visitor for money before it
          has told them who is asking or why. */}
      <StorySection />

      <section className="section">
        <div className="container">
          <PathCards />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="The cause"
            title="Where the money goes"
            subtitle="The Maboneng Foundation pays for heart operations for South African children whose families can't. Everything raised through this ride goes to them."
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
        </div>
        <div className="full-bleed">
          <StravaFeed />
        </div>
        <div className="container">
          <p style={{ marginTop: "1.5rem" }}>
            <Link to="/follow">More ways to follow &rarr;</Link>
          </p>
        </div>
      </section>
    </>
  );
}
