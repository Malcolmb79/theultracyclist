import FundraiserProgress from "../components/fundraiser/FundraiserProgress";
import SectionHeading from "../components/shared/SectionHeading";

export default function CausePage() {
  return (
    <section className="section">
      <div className="container">
        <SectionHeading eyebrow="The cause" title="The Maboneng Foundation" />
        <p>
          In South Africa, 10,000 babies are born with a congenital heart defect every year.
          Around 700 get the operation they need to reach adulthood. The rest go without, mostly
          because their families cannot pay for it.
        </p>
        <p>
          This ride raises money for The Maboneng Foundation, which pays for those operations.
          Donations go to surgery for children who would otherwise not get it.
        </p>
        <div style={{ marginTop: "2rem" }}>
          <FundraiserProgress />
        </div>
      </div>
    </section>
  );
}
