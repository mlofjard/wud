const express = require('express');
const nocache = require('nocache');
const storeContainer = require('../store/container');
const registry = require('../registry');
const { getServerConfiguration } = require('../configuration');
const { mapComponentsToList } = require('./component');
const Trigger = require('../triggers/providers/Trigger');

const router = express.Router();

const serverConfiguration = getServerConfiguration();

/**
 * Return registered watchers.
 * @returns {{id: string}[]}
 */
function getWatchers() {
    return registry.getState().watcher;
}

/**
 * Return registered triggers.
 * @returns {{id: string}[]}
 */
function getTriggers() {
    return registry.getState().trigger;
}

/**
 * Get containers from store.
 * @param query
 * @returns {*}
 */
function getContainersFromStore(query) {
    return storeContainer.getContainers(query);
}

/**
 * Get all (filtered) containers.
 * @param req
 * @param res
 */
function getContainers(req, res) {
    const { query } = req;
    res.status(200).json(getContainersFromStore(query));
}

/**
 * Get a container by id.
 * @param req
 * @param res
 */
function getContainer(req, res) {
    const { id } = req.params;
    const container = storeContainer.getContainer(id);
    if (container) {
        res.status(200).json(container);
    } else {
        res.sendStatus(404);
    }
}

/**
 * Delete a container by id.
 * @param req
 * @param res
 */
function deleteContainer(req, res) {
    if (!serverConfiguration.feature.delete) {
        res.sendStatus(403);
    } else {
        const { id } = req.params;
        const container = storeContainer.getContainer(id);
        if (container) {
            storeContainer.deleteContainer(id);
            res.sendStatus(204);
        } else {
            res.sendStatus(404);
        }
    }
}

/**
 * Watch all containers.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function watchContainers(req, res) {
    try {
        await Promise.all(
            Object.values(getWatchers()).map((watcher) => watcher.watch()),
        );
        getContainers(req, res);
    } catch (e) {
        res.status(500).json({
            error: `Error when watching images (${e.message})`,
        });
    }
}

async function getContainerTriggers(req, res) {
    const { id } = req.params;

    const container = storeContainer.getContainer(id);
    if (container) {
        const allTriggers = mapComponentsToList(getTriggers());
        const includedTriggers = container.triggerInclude
            ? container.triggerInclude
                  .split(/\s*,\s*/)
                  .map((includedTrigger) =>
                      Trigger.parseIncludeOrIncludeTriggerString(
                          includedTrigger,
                      ),
                  )
            : undefined;
        const excludedTriggers = container.triggerExclude
            ? container.triggerExclude
                  .split(/\s*,\s*/)
                  .map((excludedTrigger) =>
                      Trigger.parseIncludeOrIncludeTriggerString(
                          excludedTrigger,
                      ),
                  )
            : undefined;
        const associatedTriggers = [];
        allTriggers.forEach((trigger) => {
            const triggerToAssociate = { ...trigger };
            let associated = true;
            if (includedTriggers) {
                const includedTrigger = includedTriggers.find(
                    (tr) => tr.id === trigger.id,
                );
                if (includedTrigger) {
                    triggerToAssociate.configuration.threshold =
                        includedTrigger.threshold;
                } else {
                    associated = false;
                }
            }
            if (
                excludedTriggers &&
                excludedTriggers
                    .map((excludedTrigger) => excludedTrigger.id)
                    .includes(trigger.id)
            ) {
                associated = false;
            }
            if (associated) {
                associatedTriggers.push(triggerToAssociate);
            }
        });
        res.status(200).json(associatedTriggers);
    } else {
        res.sendStatus(404);
    }
}

/**
 * Watch an image.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function watchContainer(req, res) {
    const { id } = req.params;

    const container = storeContainer.getContainer(id);
    if (container) {
        const watcher = getWatchers()[`docker.${container.watcher}`];
        if (!watcher) {
            res.status(500).json({
                error: `No provider found for container ${id} and provider ${container.watcher}`,
            });
        } else {
            try {
                // Ensure container is still in store
                // (for cases where it has been removed before running an new watchAll)
                const containers = await watcher.getContainers();
                const containerFound = containers.find(
                    (containerInList) => containerInList.id === container.id,
                );

                if (!containerFound) {
                    res.status(404).send();
                } else {
                    // Run watchContainer from the Provider
                    const containerReport =
                        await watcher.watchContainer(container);
                    res.status(200).json(containerReport.container);
                }
            } catch (e) {
                res.status(500).json({
                    error: `Error when watching container ${id} (${e.message})`,
                });
            }
        }
    } else {
        res.sendStatus(404);
    }
}

/**
 * Init Router.
 * @returns {*}
 */
function init() {
    router.use(nocache());
    router.get('/', getContainers);
    router.post('/watch', watchContainers);
    router.get('/:id', getContainer);
    router.delete('/:id', deleteContainer);
    router.get('/:id/triggers', getContainerTriggers);
    router.post('/:id/watch', watchContainer);
    return router;
}

module.exports = {
    init,
    getContainersFromStore,
};
