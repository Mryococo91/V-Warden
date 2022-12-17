import { Punish, Punishments, Users } from '@prisma/client';
import { Guild, TextChannel } from 'discord.js';
import { Colours } from '../../@types/Colours';
import { ExtendedClient } from '../../structures/Client';
import logger, { logException } from '../logger';
import sendEmbed from '../messages/sendEmbed';
import { getPunishment } from './utils';

/**
 * Actions a user on a specific guild
 * @param guild
 * @param logChannel channel to send logs to
 * @param punishments guild punishments
 * @param user
 */
export default async function (
    client: ExtendedClient,
    guild: Guild,
    logChannel: string,
    punishments: Punishments,
    user: Users
) {
    const member = guild.members.cache.get(user.id);
    if (!member) return;

    const imports = await client.prisma.getImports(user.id);
    let realCount = 0;

    try {
        if (imports.length === 1) {
            const toParse = imports[0].roles;
            if (toParse.includes('"servers":')) {
                const parsed = JSON.parse(toParse);
                const servers: string[] = parsed['servers'].split(';');
                realCount = servers.length;
            } else {
                realCount = 1;
            }
        } else {
            realCount = imports.length;
        }
    } catch (e) {
        return logger.error({
            labels: { action: 'actionUser', userId: user.id },
            message: e,
        });
    }

    const toDo: Punish = getPunishment(user.type, punishments);

    let channel: TextChannel;
    try {
        channel = (await guild.channels.fetch(logChannel ?? '')) as TextChannel;
    } catch {
        return;
    }

    if (!channel) return;

    const author = {
        name: `${member.user.username}#${member.user.discriminator} / ${member.id}`,
        icon_url: member.displayAvatarURL(),
    };

    try {
        const chan = await member.createDM();
        await chan.send({
            content: `:shield: Warden
                    You are being automodded by ${member.guild.name} for being associated with ${realCount} leaking, cheating or reselling discord servers.
                    You may attempt to appeal this via the Official Warden Discord:
                    https://discord.gg/jeFeDRasfs`,
        });
    } catch (e) {
        return;
    }

    if (toDo === 'WARN') {
        sendEmbed({
            channel,
            embed: {
                description: `:warning: User ${user.last_username} (${
                    member.id
                }) has been seen in ${realCount} bad discord servers.\n**User Status**: ${user.status.toLowerCase()} / **User Type**: ${user.type.toLowerCase()}`,
                author,
                color: Colours.GREEN,
            },
        });
    } else if (toDo === 'ROLE') {
        try {
            if (!punishments.roleId) throw new Error('Invalid role id set');
            const oldRoles = member.roles.cache.map(x => x.id).join(',');
            await member.roles.set([punishments.roleId]);
            await client.prisma.createArchiveRole({
                id: member.id,
                roles: oldRoles,
                Guild: { connect: { id: punishments.id } },
            });
        } catch (e: any) {
            const errorId = await logException(null, e);
            return sendEmbed({
                channel,
                embed: {
                    description: `I tried to remove this users role and set them to \`${punishments.roleId}\`, however I encountered an error. > Error ID: ${errorId}`,
                    author,
                    color: Colours.RED,
                },
            });
        }
    } else if (toDo === 'KICK' || toDo === 'BAN') {
        let action = null;
        if (toDo === 'BAN') {
            action = member.ban({ reason: `Warden - User Type ${user.type}` });
        } else if (toDo === 'KICK') {
            action = member.kick(`Warden - User Type ${user.type}`);
        }

        if (!action) return;

        try {
            await action;

            if (toDo === 'BAN')
                await client.prisma.createBan({ id: user.id, Guild: { connect: { id: punishments.id } } });
            logger.info({
                labels: { action: 'actionUser', guildId: member.guild.id },
                message: `${toDo}ED - ${user.last_username} (${user.id}) - ${member.guild.id}`,
            });
            sendEmbed({
                channel,
                embed: {
                    description: `:shield: User ${user.last_username} (${
                        member.id
                    }) has been punished with a ${toDo}.\nThey have been seen in ${realCount} bad discord servers.\n**User Status**: ${user.status.toLowerCase()}`,
                    author,
                    color: Colours.GREEN,
                },
            });
        } catch (e) {
            return logger.error({
                labels: { action: 'actionUser', guildId: member.guild.id },
                message: e,
            });
        }
    }
    return;
}