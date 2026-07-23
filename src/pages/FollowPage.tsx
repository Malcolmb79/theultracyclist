import InstagramFeed from "../components/social/InstagramFeed";
import StravaFeed from "../components/social/StravaFeed";
import FollowLinks from "../components/social/FollowLinks";
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
          <StravaFeed />
        </div>
      </section>
    </>
  );
}
