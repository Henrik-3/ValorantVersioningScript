import {mkdirSync, writeFileSync, rmSync, readFileSync} from 'fs';
import * as path from 'path';
import {promisify} from 'util';
import * as childProcess from 'child_process';
import axios from 'axios';

const exec = promisify(childProcess.exec);

const base_path = 'files';
const versioning_dir = path.join(base_path, 'valorant');
const temp_dir = path.join(base_path, 'temp');

const task_timeout = 30 * 60;
const refresh_timeout = 5 * 60;

async function getValorantVersion(exeFilePath) {
    const exe_file_data = readFileSync(exeFilePath);
    const pattern = Buffer.from('++Ares-Core+', 'utf16le');
    const pos = exe_file_data.indexOf(pattern) + pattern.length;

    const [branch, build_date, build_ver, version] = exe_file_data
        .slice(pos, pos + 96)
        .toString('utf16le')
        .split('\x00')
        .filter(Boolean);

    return {
        branch,
        build_date,
        build_ver,
        version,
        last_checked: new Date().toISOString(),
        version_for_api: `${branch}-shipping-${build_ver}-${version.split('.').pop().replace(/^0+/, '')}`,
    };
}

const checkUpdateForRegion = async regionData => {
    const {
        patch_url,
        valid_shards: {live},
    } = regionData;
    const region = String(live[0]);
    try {
        await exec(
            `ManifestDownloader.exe ${patch_url} -b "https://valorant.secure.dyn.riotcdn.net/channels/public/bundles" -f "ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe" -o ${temp_dir} -t 4`,
            {cwd: './', timeout: 60000}
        );
    } catch (err) {
        console.error(err);
        return;
    }

    const versionData = await getValorantVersion(path.join(temp_dir, 'ShooterGame/Binaries/Win64/VALORANT-Win64-Shipping.exe'));
    writeFileSync(path.join(versioning_dir, `${region}.json`), JSON.stringify({...versionData, patch_url, region}));
};

async function main() {
    mkdirSync(temp_dir, {recursive: true});
    mkdirSync(versioning_dir, {recursive: true});

    try {
        const valorantRelease = await axios.get('https://clientconfig.rpg.riotgames.com/api/v1/config/public?namespace=keystone.products.valorant.patchlines', {
            timeout: 1000,
        });
        const configurations = valorantRelease.data['keystone.products.valorant.patchlines.live'].platforms.win.configurations;

        for (const configuration of configurations) {
            await checkUpdateForRegion(configuration);
        }
    } catch (err) {
        console.error(err);
    }

    rmSync(temp_dir, {recursive: true});
    console.log(`Last checked on: ${new Date().toLocaleString()}`);

    await new Promise(resolve => setTimeout(resolve, task_timeout * 1000));
}

main().catch(console.error);
