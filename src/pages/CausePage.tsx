import FundraiserProgress from "../components/fundraiser/FundraiserProgress";
import SectionHeading from "../components/shared/SectionHeading";

export default function CausePage() {
  return (
    <section className="section">
      <div className="container">
        <SectionHeading eyebrow="The cause" title="The Maboneng Foundation" />
        <p>
          In South Africa, 10,000 babies are born with a Congenital Heart Defect (CHD) every
          single year. But only 700 will receive the life-changing surgery they need to make it
          to adulthood.
        </p>
        <p>
          This ride is raising funds for The Maboneng Foundation to help close that gap — every
          donation goes toward life-saving heart surgeries for children who would otherwise not
          get the chance.
        </p>
        <div style={{ marginTop: "2rem" }}>
          <FundraiserProgress />
        </div>
      </div>
    </section>
  );
}
