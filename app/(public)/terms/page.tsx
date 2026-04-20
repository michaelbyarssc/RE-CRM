export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: April 20, 2026</p>

      <div className="prose prose-sm dark:prose-invert space-y-6">
        <section>
          <h2 className="text-xl font-semibold mb-2">1. Acceptance of Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            By accessing or using Deal Desk Pro (&quot;the Service&quot;) at dealdeskpro.com, you agree to be bound by
            these Terms of Service. If you do not agree to these terms, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">2. Description of Service</h2>
          <p className="text-muted-foreground leading-relaxed">
            Deal Desk Pro is a customer relationship management (CRM) platform designed for real estate
            professionals. The Service includes lead management, pipeline tracking, calendar scheduling,
            mapping, skip tracing integrations, and other tools to help manage real estate transactions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">3. User Accounts</h2>
          <ul className="list-disc pl-6 text-muted-foreground space-y-1">
            <li>You must provide accurate and complete information when creating an account.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You are responsible for all activities that occur under your account.</li>
            <li>You must notify us immediately of any unauthorized use of your account.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">4. Acceptable Use</h2>
          <p className="text-muted-foreground leading-relaxed">
            You agree to use the Service only for lawful purposes and in accordance with these Terms.
            You agree not to:
          </p>
          <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
            <li>Use the Service for any illegal or unauthorized purpose</li>
            <li>Attempt to gain unauthorized access to the Service or its systems</li>
            <li>Interfere with or disrupt the Service or servers</li>
            <li>Upload malicious code or content</li>
            <li>Violate any applicable laws or regulations, including real estate and telemarketing laws</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">5. Third-Party Integrations</h2>
          <p className="text-muted-foreground leading-relaxed">
            The Service may integrate with third-party services such as Google Calendar, skip tracing providers,
            and telephony services. Your use of these integrations is subject to the respective third-party
            terms of service and privacy policies. We are not responsible for the availability or functionality
            of third-party services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">6. Data Ownership</h2>
          <p className="text-muted-foreground leading-relaxed">
            You retain all ownership rights to the data you enter into the Service, including lead information,
            notes, and other CRM data. We do not claim ownership of your data. You grant us a limited license
            to store, process, and display your data solely for the purpose of providing the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">7. Disclaimer of Warranties</h2>
          <p className="text-muted-foreground leading-relaxed">
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express
            or implied. We do not warrant that the Service will be uninterrupted, error-free, or secure.
            We are not responsible for the accuracy of any lead data, skip trace results, or other information
            obtained through the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">8. Limitation of Liability</h2>
          <p className="text-muted-foreground leading-relaxed">
            To the maximum extent permitted by law, Deal Desk Pro shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages arising out of or related to your use
            of the Service, including but not limited to loss of profits, data, or business opportunities.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">9. Termination</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may terminate or suspend your access to the Service at any time, with or without cause.
            Upon termination, your right to use the Service will immediately cease. You may request
            export of your data prior to account termination.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">10. Changes to Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            We reserve the right to modify these Terms at any time. We will provide notice of significant
            changes by posting the updated Terms on this page. Your continued use of the Service after
            changes constitutes acceptance of the new Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">11. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have any questions about these Terms, please contact us at:{" "}
            <a href="mailto:michaelbyarssc@gmail.com" className="text-primary hover:underline">
              michaelbyarssc@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
