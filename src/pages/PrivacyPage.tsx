export function PrivacyPage() {
  return (
    <div className="page" style={{ maxWidth: "760px" }}>
      <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.6rem" }}>Privacy policy</h1>
      <p className="panel-subhead" style={{ marginBottom: "2rem" }}>
        Last updated July 19, 2026.
      </p>

      <div className="legal-body">
        <p>
          This page explains what Valida collects, why, and who we share it
          with. We've tried to write it the way we'd explain it to a friend,
          not the way a law firm would.
        </p>

        <h2>What we collect</h2>
        <p>When you create an account, we collect your email address and password (stored securely by our authentication provider, Supabase; we never see your password in plain text).</p>
        <p>
          When you submit an idea for scoring, we collect the business idea
          and niche/category text you type in, along with the research report
          we generate from it (score, summary, risks, and competitors) and the
          date you submitted it. If you join the waitlist to track a niche, we
          store which niche you asked us to watch.
        </p>
        <p>
          We don't run ad trackers or analytics scripts, and we don't collect
          anything beyond what's described above.
        </p>

        <h2>How we use it</h2>
        <p>
          We use your idea and niche text to research your market and
          generate your score and report. We use your email to manage your
          account and, if you've joined the waitlist, to notify you when
          weekly monitoring launches. We don't use your data to train any
          model, and we don't sell it.
        </p>

        <h2>Who we share it with</h2>
        <p>We work with a small number of service providers to run Valida:</p>
        <ul>
          <li>
            <strong>Supabase</strong> stores your account and submission data
            and handles authentication.
          </li>
          <li>
            <strong>Anthropic</strong> (Claude) processes the idea and niche
            text you submit in order to research your market and generate
            your report. This includes using a web search tool to look up
            real competitors and pricing.
          </li>
          <li>
            <strong>Vercel</strong> hosts the Valida website.
          </li>
        </ul>
        <p>
          None of these providers use your data for their own purposes beyond
          providing the service we've asked them for.
        </p>

        <h2>Cookies and local storage</h2>
        <p>
          Your login session is stored in your browser so you stay signed in
          between visits. If you start typing an idea before logging in, it's
          held temporarily in your browser (not our servers) so you don't have
          to retype it after you sign up, and it's cleared as soon as you log
          out or close the tab. During our private pre-launch period, we also
          set a single cookie to remember that you've entered the access
          password; it doesn't identify you personally.
        </p>

        <h2>How long we keep it</h2>
        <p>
          We keep your account and submission data for as long as your
          account exists. If you'd like your data deleted, contact us (below)
          and we'll remove it.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on where you live, you may have the right to access,
          correct, export, or delete the personal data we hold about you. To
          exercise any of these, email us and we'll take care of it.
        </p>

        <h2>Security</h2>
        <p>
          We use industry-standard practices to protect your data, including
          encryption in transit and database-level access controls that
          restrict each account to its own data. No system is perfectly
          secure, so we can't guarantee absolute security, but we take
          reasonable steps to protect what you share with us.
        </p>

        <h2>Children's privacy</h2>
        <p>Valida isn't directed at children, and we don't knowingly collect data from anyone under 16.</p>

        <h2>Changes to this policy</h2>
        <p>
          If we make material changes to this policy, we'll update the date
          at the top of this page.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, or want your data deleted? Email{" "}
          <a href="mailto:hendleryair@gmail.com">hendleryair@gmail.com</a>.
        </p>
      </div>
    </div>
  );
}
