import { Outlet } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import { useDashboardTheme } from "../../utils/useDashboardTheme";
import styles from "./Layout.module.css";

// Same light/dark theme mechanism as the private dashboard (see
// useDashboardTheme's own comment) - the public marketing site now follows
// whatever theme preference is stored (day/night auto-switching, or a
// manual light/dark pick made from Settings), instead of always being
// dark. Since Layout wraps every public route via <Outlet/>, this is the
// one place that needs it for the whole site.
export default function Layout() {
  useDashboardTheme();
  return (
    <>
      <Header />
      <main className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
