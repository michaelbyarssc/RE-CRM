export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: April 20, 2026</p>

      <div className="prose prose-sm dark:prose-invert space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-2">1. Introduction</h2>
          <p className="text-muted-foreground leading-relaxed">
            Deal Desk Pro (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) operates the website dealdeskpro.com (the &quot;Service&quot;).
            This Privacy Policy explains how we collect, use, and protect your information when you use our Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">2. Information We Collect</h2>
          <p className="text-muted-foreground leading-relaxed">
            We collect the following types of information:
          </p>
          <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
            <li><strong>Account Information:</strong> Email address and password when you create an account.</li>
            <li><strong>CRM Data:</strong> Lead information, property details, buyer information, notes, and other data you enter into the platform.</li>
            <li><strong>Calendar Data:</strong> When you connect Google Calendar, we access your calendar events to provide two-way synchronization. We only read and write calendar events — we do not access other Google account data.</li>
            <li><strong>Usage Data:</strong> Basic analytics about how you interact with the Service.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">3. How We Use Your Information</h2>
          <ul className="list-disc pl-6 text-muted-foreground space-y-1">
            <li>To provide and maintain the Service</li>
            <li>To manage your account and provide customer support</li>
            <li>To synchronize calendar events between Deal Desk Pro and Google Calendar</li>
            <li>To improve and optimize the Service</li>
            <li>To detect and prevent fraud or abuse</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">4. Google Calendar Integration</h2>
          <p className="text-muted-foreground leading-relaxed">
            When you connect your Google Calendar, we request access to view and manage your calendar events.
            We use this access solely to synchronize events between Deal Desk Pro and your Google Calendar.
            We do not share your Google Calendar data with any third parties. You can disconnect Google Calendar
            at any time from the Settings page, which revokes our access to your calendar data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">5. Data Storage and Security</h2>
          <p className="text-muted-foreground leading-relaxed">
            Your data is stored securely using Supabase (PostgreSQL) with encryption at rest and in transit.
            OAuth tokens for Google Calendar are stored in our database and are used only for the purposes described above.
            We implement industry-standard security measures to protect your information.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">6. Data Sharing</h2>
          <p className="text-muted-foreground leading-relaxed">
            We do not sell, trade, or otherwise transfer your personal information to third parties.
            We may share data only when required by law or to protect our rights.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">7. Your Rights</h2>
          <p className="text-muted-foreground leading-relaxed">
            You have the right to access, update, or delete your personal data at any time through the Service.
            You can disconnect third-party integrations (like Google Calendar) from the Settings page.
            To request complete deletion of your account and data, contact us at the email below.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">8. Changes to This Policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting
            the new Privacy Policy on this page and updating the &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">9. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have any questions about this Privacy Policy, please contact us at:{" "}
            <a href="mailto:michaelbyarssc@gmail.com" className="text-primary hover:underline">
              michaelbyarssc@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
