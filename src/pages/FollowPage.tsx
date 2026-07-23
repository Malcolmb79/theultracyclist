import InstagramFeed from "../components/social/InstagramFeed";
import StravaFeed from "../components/social/StravaFeed";
import FollowLinks from "../components/social/FollowLinks";
import WhoopSummary from "../components/recovery/WhoopSummary";
import AppleHealthSummary from "../components/recovery/AppleHealthSummary";
import SectionHeading from "../components/shared/SectionHeading";

export default function FollowPage() {
  return (
    <>
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Follow along" title="Follow the journey" />
          <FollowLinks />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading title="From Instagram" />
          <InstagramFeed />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading title="From Strava" />
        </div>
        <div className="full-bleed">
          <StravaFeed />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Training" title="Recovery" />
          <WhoopSummary />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Health" title="Apple Health" />
          <AppleHealthSummary />
        </div>
      </section>
    </>
  );
}
