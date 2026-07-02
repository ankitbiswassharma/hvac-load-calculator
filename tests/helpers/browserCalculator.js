/**
 * Shared harness: loads the browser calculator bundle (hvacPlatform.js and
 * its engine dependencies) inside a Node VM sandbox so tests and scripts can
 * call HvacPlatformTest.calculateRoom() exactly as the UI does.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EngineeringCore = require("../../engineeringCore.js");

function loadBrowserCalculator() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const elements = new Map();
  const project = {
    name: "Golden Case",
    rooms: [],
    activeRoomId: "golden-case",
    diversityFactor: 85,
    costingContext: null
  };
  const sandbox = {
    console: console,
    module: { exports: {} },
    exports: {},
    require: require,
    __HVAC_TEST_MODE: true,
    EngineeringCore: EngineeringCore,
    STD_TR: [1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 12.5, 15, 20, 25, 30, 35, 40, 50, 60],
    localStorage: {
      getItem: function () { return null; },
      setItem: function () {},
      removeItem: function () {}
    },
    location: { search: "", href: "http://localhost/test", protocol: "http:" },
    history: { replaceState: function () {} },
    setTimeout: function () {},
    clearTimeout: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    scrollTo: function () {},
    print: function () {}
  };
  sandbox.window = sandbox;
  sandbox.document = {
    readyState: "complete",
    title: "Test",
    getElementById: function (id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id: id,
          value: "",
          dataset: {},
          style: {},
          innerHTML: "",
          outerHTML: "",
          textContent: "",
          disabled: false,
          readOnly: false,
          tagName: "INPUT",
          classList: { toggle: function () {}, add: function () {}, remove: function () {} },
          addEventListener: function () {},
          removeEventListener: function () {},
          querySelector: function () { return null; }
        });
      }
      return elements.get(id);
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () {
      return {
        dataset: {},
        style: {},
        setAttribute: function () {},
        addEventListener: function () {}
      };
    },
    addEventListener: function () {}
  };
  sandbox.ProjectManager = {
    getProject: function () {
      return project;
    },
    getActiveRoom: function () {
      return project.rooms.find(function (room) { return room.id === project.activeRoomId; }) || null;
    },
    setDiversityFactor: function (value) {
      project.diversityFactor = value;
    },
    listSavedProjects: function () {
      return [];
    }
  };
  sandbox.AuthManager = {
    hydrateSession: async function () { return null; },
    getCurrentUser: function () { return null; },
    isAuthenticated: function () { return false; }
  };
  sandbox.ServerApi = {
    isAvailable: async function () { return false; },
    hasCapability: async function () { return false; }
  };

  vm.createContext(sandbox);
  ["solarEngine.js", "diffuserLayout.js", "equipmentEngine.js", "costingEngine.js", "optimizationEngine.js", "hvacPlatform.js"].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), "utf8"), sandbox, { filename: file });
  });
  sandbox.__project = project;
  sandbox.__elements = elements;
  return sandbox;
}

module.exports = { loadBrowserCalculator: loadBrowserCalculator };
