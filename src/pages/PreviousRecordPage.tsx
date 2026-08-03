import SectionHeading from "../components/shared/SectionHeading";
import StatTile from "../components/shared/StatTile";
import { previousRecord } from "../data/previousRecord";
import { formatDate } from "../utils/formatDate";
import styles from "./PreviousRecordPage.module.css";

export default function PreviousRecordPage() {
  return (
    <section className="section">
      <div className="container">
        <SectionHeading
          eyebrow="Previous record"
          title={previousRecord.title}
          subtitle={`${previousRecord.subtitle}: ${previousRecord.start.name} to ${previousRecord.finish.name}, ${formatDate(previousRecord.date)}`}
        />

        <img
          className={styles.poster}
          src={previousRecord.posterImage}
          alt={`${previousRecord.title} route map and stats poster`}
        />

        <p>
          In 2022, before taking on the full length of the country, Malcolm broke the world record
          for crossing Ireland east to west. Wicklow Head Lighthouse to Slea Head is{" "}
          {previousRecord.distanceKm}km, and he rode it in {previousRecord.totalTime}. That one was
          for The Maboneng Foundation too.
        </p>

        <div className={styles.stats}>
          <StatTile value={previousRecord.totalTime} label="Total time" />
          <StatTile value={`${previousRecord.distanceKm} km`} label="Distance" />
          <StatTile value={`${previousRecord.avgSpeedKmh} km/h`} label="Avg speed" />
          <StatTile value={`${previousRecord.maxSpeedKmh} km/h`} label="Max speed" />
          <StatTile value={`${previousRecord.elevationM.toLocaleString("en-GB")} m`} label="Elevation" />
        </div>

        <SectionHeading title="Support crew" />
        <ul className={styles.crew}>
          {previousRecord.supportCrew.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>

        <SectionHeading title="Splits" />
        <div className={styles.splitsWrap}>
          <table className={styles.splitsTable}>
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>Distance</th>
                <th>Elapsed time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{previousRecord.start.name} (start)</td>
                <td>0 km</td>
                <td>0:00:00</td>
              </tr>
              {previousRecord.splits.map((split) => (
                <tr key={split.name}>
                  <td>{split.name}</td>
                  <td>{split.km} km</td>
                  <td>{split.time}</td>
                </tr>
              ))}
              <tr>
                <td>{previousRecord.finish.name} (finish)</td>
                <td>{previousRecord.finish.km} km</td>
                <td>{previousRecord.finish.time}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
