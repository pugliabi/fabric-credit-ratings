import type { ReactNode } from 'react';
import styles from './AboutPage.module.css';

const KROSNICK =
  'https://web.stanford.edu/dept/communication/faculty/krosnick/docs/2010/2010%20Handbook%20of%20Survey%20Research.pdf';
const MEASURINGU = 'https://measuringu.com/ratingscales-myth-evidence/';

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function AboutPage() {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <a className={styles.back} href="/">
            ← Back to the ratings
          </a>
          <h1 className={styles.title}>About these ratings</h1>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <h2>What this is</h2>
          <p>
            Microsoft Fabric Credit Ratings grades each Fabric item the way a credit agency grades a bond, from AAA down
            to C, so you can see at a glance what is ready to build on and what to plan around. Retired items are rated
            D.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Where the ratings come from</h2>
          <p>
            The ratings are opinions. Microsoft MVPs and other practitioners who build on Fabric every day score each
            item in review rounds. Each rater scores the items they know, the scores are averaged, and a short note
            explains each rating. They are subjective judgments, not measurements, benchmarks, or advice to buy.
          </p>
        </section>

        <section className={styles.section}>
          <h2 id="scale" className={styles.anchor}>
            Why a 1 to 7 scale
          </h2>
          <p>
            Each item is scored from 1 to 7 on four factors: Feature Capability, User Experience, CU / Token Cost, and
            Outlook. Survey research finds that scales of five to seven points give the most reliable answers, and that
            seven points suit judgments that need finer distinctions, like these (
            <External href={KROSNICK}>Krosnick and Presser, Question and Questionnaire Design</External>). Going
            beyond seven points adds little reliability (
            <External href={MEASURINGU}>MeasuringU, Rating Scales: Myth vs. Evidence</External>). The site does not
            publish how the four scores combine into a grade.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Who built this</h2>
          <p>
            Microsoft Fabric Credit Ratings was built by Tommy Puglia of{' '}
            <External href="https://pugliabi.com">Puglia BI Consulting</External>, a Microsoft Fabric and Power BI
            consultancy. Tommy writes about AI and business intelligence at{' '}
            <External href="https://promptingbi.com">Prompting BI</External>.
          </p>
          <ul className={styles.links}>
            <li>
              <External href="https://pugliabi.com/contact">Contact Puglia BI Consulting</External>
            </li>
            <li>
              <External href="https://www.linkedin.com/in/tommypuglia">Tommy Puglia on LinkedIn</External>
            </li>
            <li>
              <External href="https://www.linkedin.com/company/puglia-bi-consulting">
                Puglia BI Consulting on LinkedIn
              </External>
            </li>
          </ul>
        </section>

        <p className={styles.fine}>
          Independent and unofficial. Not affiliated with or endorsed by Microsoft. Microsoft Fabric is a trademark of
          Microsoft Corporation.
        </p>
      </main>
    </>
  );
}
