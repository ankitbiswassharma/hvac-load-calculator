(function () {
  let availabilityPromise = null;
  let healthSnapshot = null;

  function isFileProtocol() {
    return window.location && window.location.protocol === "file:";
  }

  async function request(path, options) {
    const response = await window.fetch(path, Object.assign({
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    }, options || {}));

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.indexOf("application/json") !== -1
      ? await response.json()
      : { ok: response.ok, error: await response.text() };

    if (!response.ok) {
      return Object.assign({ ok: false, status: response.status }, payload || {});
    }

    return payload;
  }

  const api = {
    async isAvailable() {
      if (!window.fetch || isFileProtocol()) {
        return false;
      }
      if (!availabilityPromise) {
        availabilityPromise = request("/api/health", { method: "GET" }).then(function (response) {
          healthSnapshot = response || null;
          return !!(response && response.ok);
        }).catch(function () {
          healthSnapshot = null;
          return false;
        });
      }
      return availabilityPromise;
    },

    async hasCapability(capabilityName) {
      const available = await this.isAvailable();
      if (!available) {
        return false;
      }
      const capabilities = healthSnapshot && healthSnapshot.capabilities
        ? healthSnapshot.capabilities
        : {};
      return !!capabilities[capabilityName];
    },

    async register(payload) {
      return request("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async login(payload) {
      return request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async getLicensingPlans() {
      return request("/api/licensing/plans", { method: "GET" });
    },

    async getLicenseInvite(token) {
      return request("/api/licensing/invite?token=" + encodeURIComponent(token || ""), { method: "GET" });
    },

    async submitDemoRequest(payload) {
      return request("/api/leads/demo", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async submitQuoteRequest(payload) {
      return request("/api/leads/quote", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async createLicenseOrder(payload) {
      return request("/api/licensing/create-order", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async confirmLicensePayment(payload) {
      return request("/api/licensing/confirm-payment", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async logout() {
      return request("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
    },

    async resetPassword(payload) {
      return request("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async forgotPassword(payload) {
      return request("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async getSession() {
      return request("/api/auth/session", { method: "GET" });
    },

    async getClimateMeta() {
      return request("/api/climate/meta", { method: "GET" });
    },

    async listClimateStations(filters) {
      const params = new URLSearchParams();
      const options = filters || {};
      if (options.region) {
        params.set("region", options.region);
      }
      if (options.q) {
        params.set("q", options.q);
      }
      if (options.limit) {
        params.set("limit", String(options.limit));
      }
      const query = params.toString();
      return request("/api/climate/stations" + (query ? "?" + query : ""), { method: "GET" });
    },

    async saveProject(projectName, project) {
      return request("/api/projects/save", {
        method: "POST",
        body: JSON.stringify({
          projectName: projectName,
          project: project
        })
      });
    },

    async loadProject(projectName) {
      const url = projectName
        ? "/api/projects/load?name=" + encodeURIComponent(projectName)
        : "/api/projects/autosave";
      return request(url, { method: "GET" });
    },

    async saveAutosave(project) {
      return request("/api/projects/autosave", {
        method: "POST",
        body: JSON.stringify({ project: project })
      });
    },

    async listProjects() {
      return request("/api/projects", { method: "GET" });
    },

    async simulateEnergy(payload) {
      return request("/api/energy/simulate", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async compareEnergy(payload) {
      return request("/api/energy/compare", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async getAdminOverview() {
      return request("/api/admin/overview", { method: "GET" });
    },

    async getOwnerOverview() {
      return request("/api/owner/overview", { method: "GET" });
    },

    async updateCompanyPricing(payload) {
      return request("/api/owner/company-pricing", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async getCompanyOverview(companyId) {
      const query = companyId ? "?companyId=" + encodeURIComponent(companyId) : "";
      return request("/api/company/overview" + query, { method: "GET" });
    },

    async createCompanyUser(payload) {
      return request("/api/company/users", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
    },

    async updateCompanyUser(payload) {
      return request("/api/company/users", {
        method: "PATCH",
        body: JSON.stringify(payload || {})
      });
    },

    async deleteCompanyUser(payload) {
      return request("/api/company/users", {
        method: "DELETE",
        body: JSON.stringify(payload || {})
      });
    }
  };

  window.ServerApi = api;
}());
