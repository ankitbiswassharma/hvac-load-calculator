(function () {
  const AUTOSAVE_KEY = "hvac-platform-autosave-v1";
  const PROJECTS_KEY = "hvac-platform-projects-v1";
  let storageScope = "public";

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slugify(text) {
    return String(text || "project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  }

  function createRoomName(index) {
    return "Room " + index;
  }

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function scopedKey(baseKey) {
    return baseKey + "::" + storageScope;
  }

  function createProject(defaultInputs) {
    const firstRoom = {
      id: "room-1",
      name: "Room 1",
      inputs: clone(defaultInputs || {}),
      result: null
    };

    return {
      version: 1,
      name: "HVAC Project",
      activeRoomId: firstRoom.id,
      diversityFactor: 85,
      rooms: [firstRoom],
      savedAt: nowIso()
    };
  }

  const manager = {
    project: null,
    roomFieldIds: [],
    debounceHandle: null,
    savedProjectsIndex: [],

    init: function (config) {
      this.setStorageScope((config && config.storageScope) || storageScope);
      this.roomFieldIds = (config && config.roomFieldIds) || [];
      this.project = createProject((config && config.defaultInputs) || {});
      this.savedProjectsIndex = [];
      return this.project;
    },

    setStorageScope: function (scope) {
      storageScope = slugify(scope || "public");
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      return storageScope;
    },

    getStorageScope: function () {
      return storageScope;
    },

    ensureProject: function (defaultInputs) {
      if (!this.project) {
        this.project = createProject(defaultInputs || {});
      }
      return this.project;
    },

    resetProject: function (defaultInputs) {
      this.project = createProject(defaultInputs || {});
      return this.project;
    },

    getProject: function () {
      return this.project;
    },

    getActiveRoom: function () {
      if (!this.project) {
        return null;
      }
      return this.project.rooms.find(function (room) {
        return room.id === manager.project.activeRoomId;
      }) || this.project.rooms[0] || null;
    },

    getRoomById: function (roomId) {
      return (this.project && this.project.rooms.find(function (room) {
        return room.id === roomId;
      })) || null;
    },

    addRoom: function (inputs) {
      const nextIndex = (this.project ? this.project.rooms.length : 0) + 1;
      const room = {
        id: "room-" + Date.now() + "-" + nextIndex,
        name: createRoomName(nextIndex),
        inputs: clone(inputs || {}),
        result: null
      };
      this.project.rooms.push(room);
      this.project.activeRoomId = room.id;
      this.project.savedAt = nowIso();
      this.autoSave();
      return room;
    },

    renameRoom: function (roomId, nextName) {
      const room = this.getRoomById(roomId);
      const trimmedName = String(nextName || "").trim();
      if (!room || !trimmedName) {
        return null;
      }
      room.name = trimmedName;
      this.project.savedAt = nowIso();
      this.autoSave();
      return room;
    },

    deleteRoom: function (roomId) {
      if (!this.project || this.project.rooms.length <= 1) {
        return this.getActiveRoom();
      }
      this.project.rooms = this.project.rooms.filter(function (room) {
        return room.id !== roomId;
      });
      if (!this.getRoomById(this.project.activeRoomId)) {
        this.project.activeRoomId = this.project.rooms[0].id;
      }
      this.project.savedAt = nowIso();
      this.autoSave();
      return this.getActiveRoom();
    },

    selectRoom: function (roomId) {
      if (!this.getRoomById(roomId)) {
        return null;
      }
      this.project.activeRoomId = roomId;
      this.project.savedAt = nowIso();
      this.autoSave();
      return this.getActiveRoom();
    },

    updateActiveInputs: function (inputs) {
      const room = this.getActiveRoom();
      if (!room) {
        return null;
      }
      room.inputs = clone(inputs || {});
      if (!room.inputs.ahu_group) {
        room.inputs.ahu_group = "AHU-1";
      }
      this.project.savedAt = nowIso();
      return room;
    },

    updateActiveResult: function (result) {
      const room = this.getActiveRoom();
      if (!room) {
        return null;
      }
      room.result = clone(result || null);
      this.project.savedAt = nowIso();
      this.autoSave();
      return room;
    },

    updateRoomResult: function (roomId, result) {
      const room = this.getRoomById(roomId);
      if (!room) {
        return null;
      }
      room.result = clone(result || null);
      this.project.savedAt = nowIso();
      this.autoSave();
      return room;
    },

    setProjectName: function (name) {
      if (!this.project) {
        return;
      }
      this.project.name = name || "HVAC Project";
      this.project.savedAt = nowIso();
      this.autoSave();
    },

    setDiversityFactor: function (value) {
      if (!this.project) {
        return;
      }
      this.project.diversityFactor = value;
      this.project.savedAt = nowIso();
      this.autoSave();
    },

    saveProject: function (projectName) {
      const self = this;
      if (!this.project) {
        return Promise.resolve(null);
      }
      const name = projectName || this.project.name || "HVAC Project";
      this.project.name = name;
      this.project.savedAt = nowIso();

      if (window.ServerApi) {
        return window.ServerApi.isAvailable().then(function (available) {
          if (available) {
            return window.ServerApi.saveProject(name, self.project).then(function (response) {
              if (response && response.ok) {
                self.savedProjectsIndex = response.projects || self.savedProjectsIndex;
                return clone(self.project);
              }
              return null;
            });
          }

          const projects = readJson(scopedKey(PROJECTS_KEY), {});
          projects[slugify(name)] = clone(self.project);
          writeJson(scopedKey(PROJECTS_KEY), projects);
          writeJson(scopedKey(AUTOSAVE_KEY), self.project);
          self.savedProjectsIndex = self.listSavedProjects(true);
          return clone(self.project);
        });
      }

      const projects = readJson(scopedKey(PROJECTS_KEY), {});
      projects[slugify(name)] = clone(this.project);
      writeJson(scopedKey(PROJECTS_KEY), projects);
      writeJson(scopedKey(AUTOSAVE_KEY), this.project);
      this.savedProjectsIndex = this.listSavedProjects(true);
      return Promise.resolve(clone(this.project));
    },

    loadProject: function (projectName) {
      const self = this;

      function applyLoaded(loaded) {
        if (!loaded) {
          return null;
        }

        self.project = loaded;
        if (!self.project.rooms || !self.project.rooms.length) {
          self.project = createProject({});
        }
        if (!self.project.activeRoomId || !self.getRoomById(self.project.activeRoomId)) {
          self.project.activeRoomId = self.project.rooms[0].id;
        }
        return clone(self.project);
      }

      if (window.ServerApi) {
        return window.ServerApi.isAvailable().then(function (available) {
          if (available) {
            return window.ServerApi.loadProject(projectName || "").then(function (response) {
              if (response && response.ok) {
                if (response.projects) {
                  self.savedProjectsIndex = response.projects;
                }
                return applyLoaded(response.project || null);
              }
              return null;
            });
          }

          let loaded = null;
          if (projectName) {
            const projects = readJson(scopedKey(PROJECTS_KEY), {});
            loaded = projects[slugify(projectName)] || null;
          } else {
            loaded = readJson(scopedKey(AUTOSAVE_KEY), null);
          }
          return applyLoaded(loaded);
        });
      }

      let loaded = null;
      if (projectName) {
        const projects = readJson(scopedKey(PROJECTS_KEY), {});
        loaded = projects[slugify(projectName)] || null;
      } else {
        loaded = readJson(scopedKey(AUTOSAVE_KEY), null);
      }
      return Promise.resolve(applyLoaded(loaded));
    },

    autoSave: function () {
      const self = this;
      if (!this.project) {
        return Promise.resolve();
      }
      window.clearTimeout(this.debounceHandle);
      return new Promise(function (resolve) {
        self.debounceHandle = window.setTimeout(function () {
          if (window.ServerApi) {
            window.ServerApi.isAvailable().then(function (available) {
              if (available) {
                const authReady = !(window.AuthManager && typeof window.AuthManager.isAuthenticated === "function")
                  || window.AuthManager.isAuthenticated();
                if (!authReady) {
                  writeJson(scopedKey(AUTOSAVE_KEY), manager.project);
                  resolve();
                  return;
                }
                return window.ServerApi.saveAutosave(manager.project).then(function () {
                  resolve();
                }).catch(function () {
                  writeJson(scopedKey(AUTOSAVE_KEY), manager.project);
                  resolve();
                });
              }
              writeJson(scopedKey(AUTOSAVE_KEY), manager.project);
              resolve();
            }).catch(function () {
              writeJson(scopedKey(AUTOSAVE_KEY), manager.project);
              resolve();
            });
            return;
          }

          writeJson(scopedKey(AUTOSAVE_KEY), manager.project);
          resolve();
        }, 250);
      });
    },

    refreshSavedProjects: function () {
      const self = this;
      if (window.ServerApi) {
        return window.ServerApi.isAvailable().then(function (available) {
          if (available) {
            return window.ServerApi.listProjects().then(function (response) {
              self.savedProjectsIndex = response && response.ok ? (response.projects || []) : [];
              return self.savedProjectsIndex.slice();
            });
          }
          self.savedProjectsIndex = self.listSavedProjects(true);
          return self.savedProjectsIndex.slice();
        });
      }

      self.savedProjectsIndex = self.listSavedProjects(true);
      return Promise.resolve(self.savedProjectsIndex.slice());
    },

    listSavedProjects: function (forceRefresh) {
      if (!forceRefresh && this.savedProjectsIndex && this.savedProjectsIndex.length) {
        return this.savedProjectsIndex.slice();
      }
      const projects = readJson(scopedKey(PROJECTS_KEY), {});
      const list = Object.keys(projects).map(function (key) {
        return {
          id: key,
          name: projects[key].name,
          savedAt: projects[key].savedAt
        };
      }).sort(function (left, right) {
        return String(right.savedAt || "").localeCompare(String(left.savedAt || ""));
      });
      this.savedProjectsIndex = list.slice();
      return list;
    }
  };

  window.ProjectManager = manager;
}());
