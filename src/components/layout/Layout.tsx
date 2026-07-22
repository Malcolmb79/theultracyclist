import { Outlet } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import CyclistLayer from "../decoration/CyclistLayer";
import styles from "./Layout.module.css";

export default function Layout() {
  return (
    <>
      <CyclistLayer />
      <Header />
      <main className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
