import { useAuthSession } from "../utils/useAuthSession";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import RaceConsole from "../components/race/RaceConsole";
import { SAUCE_MOD_DOWNLOAD } from "../components/race/sauceMod";
import styles from "./RacePage.module.css";

export default function RacePage() {
  useDashboardTheme();
  const auth = useAuthSession();

  if (auth.status === "loading") {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }
  if (auth.status === "signed-out") {
    return <SignInGate title="Race" />;
  }
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends" },
            { label: "Coaching", href: "/dashboard/coaching" },
            { label: "Race", href: "/dashboard/race", active: true },
          ]}
          trailing={<ProfileMenu />}
        />
      </div>

      <PageHeader
        title="Race"
        subtitle={
          <>
            Live Zwift race data from Sauce for Zwift, recorded for commentary, tactics and the post-race review. If
            Chrome won't let this page reach Sauce, use the{" "}
            <a href={SAUCE_MOD_DOWNLOAD} download className={styles.link}>
              Sauce mod
            </a>{" "}
            instead: it runs this same console from inside Sauce.
          </>
        }
      />

      <RaceConsole />
    </div>
  );
}
