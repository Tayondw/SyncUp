const express = require("express");
const bcrypt = require("bcryptjs");

const { setTokenCookie, requireAuth } = require("../../utils/auth");
const {
	Group,
	GroupImage,
	Membership,
	User,
	Venue,
	Event,
	EventImage,
	sequelize,
} = require("../../db/models");

const { check } = require("express-validator");
const { handleValidationErrors } = require("../../utils/validation");

const { Op } = require("sequelize");

const router = express.Router();

router.get("/", async (req, res, next) => {
	const allGroups = await Group.findAll({
		attributes: [
			"id",
			"organizerId",
			"name",
			"about",
			"type",
			"private",
			"city",
			"state",
			"createdAt",
			"updatedAt",
		],
	});

	let groups = [];

	for (let group of allGroups) {
		let eachGroup = group.toJSON();

		eachGroup.numMembers = await Membership.count({
			where: {
				groupId: eachGroup.id,
				status: {
					[Op.in]: ["member", "co-host"],
				},
			},
		});

		eachGroup.numMembers += 1;

		let image = await GroupImage.findOne({
			where: {
				groupId: eachGroup.id,
				preview: true,
			},
		});

		if (image) {
			eachGroup.previewImage = image.url;
		}

		groups.push(eachGroup);
	}

	return res.json({
		Groups: groups,
	});
});

router.get("/current", requireAuth, async (req, res) => {
	const { user } = req;
	// console.log(user);
	let allGroups = await Group.findAll({
		attributes: [
			"id",
			"organizerId",
			"name",
			"about",
			"type",
			"private",
			"city",
			"state",
			"createdAt",
			"updatedAt",
		],
		where: {
			organizerId: user.id,
		},
	});

	let groups = [];

	for (let group of allGroups) {
		let eachGroup = group.toJSON();

		if (eachGroup) {
			eachGroup.numMembers = await Membership.count({
				where: {
					groupId: eachGroup.id,
					status: {
						[Op.in]: ["member", "co-host"],
					},
				},
			});

			eachGroup.numMembers += 1;

			let image = await GroupImage.findOne({
				where: {
					groupId: eachGroup.id,
					preview: true,
				},
			});

			if (image) {
				eachGroup.previewImage = image.url;
			}
		}

		groups.push(eachGroup);
	}

	return res.json({
		Groups: groups,
	});
});

router.get("/:groupId", async (req, res) => {
	const groupId = +req.params.groupId;
	let groups;
	try {
		groups = await Group.findByPk(groupId, {
			attributes: [
				"id",
				"organizerId",
				"name",
				"about",
				"type",
				"private",
				"city",
				"state",
				"createdAt",
				"updatedAt",
			],
		});
	} catch (error) {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}

	if (groups) {
		groups = await Group.findByPk(groupId, {
			attributes: [
				"id",
				"organizerId",
				"name",
				"about",
				"type",
				"private",
				"city",
				"state",
				"createdAt",
				"updatedAt",
			],
			include: [
				{
					model: Membership,
					attributes: [
						"groupId",
						[sequelize.fn("COUNT"), sequelize.col("groupId")],
					],
					status: {
						[Op.in]: ["member", "co-host"],
					},
					as: "numMembers",
				},
				{
					model: GroupImage,
					attributes: ["id", "url", "preview"],
				},
				{
					model: User,
					attributes: ["id", "firstName", "lastName"],
					as: "Organizer",
				},
				{
					model: Venue,
					where: {
						groupId: groupId,
					},
				},
			],
		});
		groups = groups.toJSON();
		groups.numMembers = groups.numMembers[0].groupId;

		res.json(groups);
	} else {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
});

router.get("/:groupId/venues", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;

	let group;

	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}

	if (group) {
		const membership = await Membership.findOne({
			where: {
				groupId: group.id,
				userId: user.id,
			},
		});

		const organizer = group.organizerId === user.id;
		const coHost = membership ? membership.status === "co-host" : false;

		if (organizer || coHost) {
			const venues = await Venue.findAll({
				where: {
					groupId: group.id,
				},
			});

			return res.json(venues);
		} else {
			res.status(403);
			res.json({
				message:
					"User must be the organizer of the group or a member of the group with a status of 'co-host'",
			});
		}
	} else {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
});

router.get("/:groupId/events", async (req, res) => {
	const groupId = +req.params.groupId;
	let group;
	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}

	if (group) {
		const events = await Event.findByPk(groupId, {
			attributes: {
				include: [
					[
						sequelize.literal(`(
                  SELECT COUNT(*)
                  FROM Attendances AS Attendance
                  WHERE
                    Attendance.eventId = Event.id AND
                    Attendance.status = 'attending')`),
						"numAttending",
					],
					[
						sequelize.literal(`(
                                    SELECT url
                                    FROM EventImages AS EventImage
                                    WHERE
                                      EventImage.eventId = Event.id
                                    LIMIT 1
                                  )`),
						"previewImage",
					],
				],
			},
			include: [
				{
					model: Group,
					attributes: ["id", "name", "city", "state"],
				},
				{
					model: Venue,
					attributes: ["id", "city", "state"],
				},
			],
		});

		return res.json({
			Events: events,
		});
	} else {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
});

router.get("/:groupId/members", async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;
	let group;

	try {
		group = await Group.findByPk(groupId);
		if (!group) {
			res.status(404);
			res.json({
				message: "Group couldn't be found",
			});
		}
		let members;

		if (user) {
			const membership = await Membership.findOne({
				where: {
					userId: user.id,
					groupId: group.id,
				},
			});
			const organizer = group.organizerId === user.id;
			const coHost = membership ? membership.status === "co-host" : false;

			if (organizer || coHost) {
				members = await Membership.findAll({
					include: {
						model: User,
						attributes: ["id", "firstName", "lastName"],
					},
					where: {
						groupId: group.id,
					},
					order: [[User, "id", "ASC"]],
				});
			} else {
				members = await Membership.findAll({
					include: {
						model: User,
						attributes: ["id", "firstName", "lastName"],
					},
					where: {
						groupId: group.id,
						status: {
							[Op.not]: ["pending"],
						},
					},
					order: [[User, "id", "ASC"]],
				});
			}
		} else {
			members = await Membership.findAll({
				include: {
					model: User,
					attributes: ["id", "firstName", "lastName"],
				},
				where: {
					groupId: group.id,
					status: {
						[Op.not]: ["pending"],
					},
				},
				order: [[User, "id", "ASC"]],
			});
		}

		const Members = members.map((member) => ({
			id: member.User.id,
			firstName: member.User.firstName,
			lastName: member.User.lastName,
			Membership: {
				status: member.status,
			},
		}));
		res.json({
			Members,
		});
	} catch (error) {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
});

router.post("/", requireAuth, async (req, res) => {
	const { user } = req;

	const { name, about, type, private, city, state } = req.body;

	try {
		const newGroup = await Group.create(
			{
				organizerId: user.id,
				name,
				about,
				type,
				private,
				city,
				state,
			},
			{ validate: true }
		);

		await newGroup.save();

		const safeGroup = {
			organizerId: newGroup.organizerId,
			name: newGroup.name,
			about: newGroup.about,
			type: newGroup.type,
			private: newGroup.private,
			city: newGroup.city,
			state: newGroup.state,
		};
		res.status(201);
		res.json(safeGroup);
	} catch (error) {
		let errorObj = { message: "Bad Request", errors: {} };
		// console.log(error.errors);
		for (let err of error.errors) {
			// console.log(err.path);
			errorObj.errors[err.path] = err.message;
		}
		// console.log(errorObj);
		res.status(400);
		res.json(errorObj);
	}
});

router.post("/:groupId/images", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;
	const { url, preview } = req.body;

	let group;
	try {
		group = await Group.findByPk(groupId, {
			include: {
				model: GroupImage,
			},
		});
	} catch (error) {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
	if (user.id !== group.organizerId) {
		res.status(403);
		return res.json({
			message: "Must be organizer of the group in order to add or change image",
		});
	}

	const newImage = await GroupImage.create(
		{
			url: url,
			preview: preview,
			groupId: group.id,
		},
		{ validate: true }
	);

	await newImage.save();

	const safeImage = {
		url: newImage.url,
		preview: newImage.preview,
	};
	res.status(200);
	res.json(safeImage);
});

router.post("/:groupId/venues", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;
	const { address, city, state, lat, lng } = req.body;
	let group;

	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(404);
		res.json({ message: "Group couldn't be found" });
	}

	if (group) {
		if (group.organizerId === user.id) {
			try {
				const newVenue = await Venue.create(
					{
						groupId: group.id,
						address,
						city,
						state,
						lat,
						lng,
					},
					{ validate: true }
				);
				await newVenue.save();
				let safeVenue = {
					id: newVenue.id,
					groupId: newVenue.groupId,
					address: newVenue.address,
					city: newVenue.city,
					state: newVenue.state,
					lat: newVenue.lat,
					lng: newVenue.lng,
				};
				res.json(safeVenue);
			} catch (error) {
				let errorObj = { message: "Bad Request", errors: {} };
				for (let err of error.errors) {
					errorObj.errors[err.path] = err.message;
				}
				res.status(400);
				res.json(errorObj);
			}
		} else {
			let status = await Member.findOne({
				where: {
					groupId: group.id,
					memberId: user.id,
				},
			});
			if (status) {
				if (status.status === "co-host") {
					try {
						const { address, city, state, lat, lng } = req.body;
						const newVenue = await Venue.create(
							{
								groupId: group.id,
								address,
								city,
								state,
								lat,
								lng,
							},
							{ validate: true }
						);
						await newVenue.save();
						let safeVenue = {
							id: newVenue.id,
							groupId: newVenue.groupId,
							address: newVenue.address,
							city: newVenue.city,
							state: newVenue.state,
							lat: newVenue.lat,
							lng: newVenue.lng,
						};
						res.json(safeVenue);
					} catch (error) {
						let errorObj = { message: "Bad Request", errors: {} };
						for (let err of error.errors) {
							errorObj.errors[err.path] = err.message;
						}
						res.status(400);
						res.json(errorObj);
					}
				} else {
					res.status(403);
					return res.json({
						message: "User does not have valid permissions",
					});
				}
			} else {
				res.status(403);
				return res.json({ message: "User is not a member of this group" });
			}
		}
	} else {
		res.status(404);
		res.json({ message: "Group couldn't be found" });
	}
});

router.post("/:groupId/events", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;
	const {
		venueId,
		name,
		type,
		capacity,
		price,
		description,
		startDate,
		endDate,
	} = req.body;

	let group;

	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}

	if (group) {
		if (group.organizerId === user.id) {
			try {
				let venue;
				if (venueId) venue = await Venue.findByPk(venueId);
				if (venue === null) {
					res.status(404);
					res.json({
						message: "Venue couldn't be found",
					});
				}

				const newEvent = await Event.create({
					venueId: venueId,
					name: name,
					type: type,
					capacity: capacity,
					price: price,
					description: description,
					startDate,
					startDate,
					endDate: endDate,
					groupId: group.id,
				});

				await newEvent.save();

				const safeEvent = {
					id: newEvent.id,
					venueId: newEvent.venueId,
					name: newEvent.name,
					type: newEvent.type,
					capacity: newEvent.capacity,
					price: newEvent.price,
					description: newEvent.description,
					private: newEvent.private,
					startDate: newEvent.startDate,
					endDate: newEvent.startDate,
					groupId: newEvent.groupId,
				};
				res.status(200);
				res.json(safeEvent);
			} catch (error) {
				let errorObj = { message: "Bad Request", errors: {} };
				for (let err of error.errors) {
					errorObj.errors[err.path] = err.message;
				}
				res.status(400);
				res.json(errorObj);
			}
		} else {
			let memberStatus = await Membership.findOne({
				where: {
					groupId: group.id,
					userId: user.id,
				},
			});

			if (memberStatus) {
				if (memberStatus.status === "co-host") {
					try {
						let venue;
						if (venueId) venue = await Venue.findByPk(venueId);
						if (venue === null) {
							res.status(404);
							res.json({
								message: "Venue couldn't be found",
							});
						}

						const newEvent = await Event.create({
							venueId: venueId,
							name: name,
							type: type,
							capacity: capacity,
							price: price,
							description: description,
							startDate,
							startDate,
							endDate: endDate,
							groupId: group.id,
						});

						await newEvent.save();

						const safeEvent = {
							id: newEvent.id,
							venueId: newEvent.venueId,
							name: newEvent.name,
							type: newEvent.type,
							capacity: newEvent.capacity,
							price: newEvent.price,
							description: newEvent.description,
							private: newEvent.private,
							startDate: newEvent.startDate,
							endDate: newEvent.startDate,
							groupId: newEvent.groupId,
						};
						res.status(200);
						res.json(safeEvent);
					} catch (error) {
						let errorObj = { message: "Bad Request", errors: {} };
						for (let err of error.errors) {
							errorObj.errors[err.path] = err.message;
						}
						res.status(400);
						res.json(errorObj);
					}
				} else {
					res.status(403);
					res.json({
						message:
							"User must be a member of the group with the status of 'co-host'",
					});
				}
			} else {
				res.status(403);
				res.json({ message: "User must be organizer of the group" });
			}
		}
	} else {
		res.status(404);
		res.json({ message: "Group couldn't be found" });
	}
});

router.post("/:groupId/membership", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;

	let group;

	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(400);
		res.json({
			message: "Group couldn't be found",
		});
	}

	if (group) {
		if (group.organizerId !== user.id) {
			const membership = await Membership.findOne({
				where: {
					userId: user.id,
					groupId: group.id,
				},
			});

			if (!membership) {
				let newMembership;
				try {
					newMembership = await Membership.create(
						{
							userId: user.id,
							status: "pending",
							groupId: group.id,
						},
						{ validate: true }
					);

					await newMembership.save();
					const safeNewMember = {
						userId: newMembership.userId,
						status: newMembership.status,
					};
					res.json(safeNewMember);
				} catch (error) {
					let errorObj = { message: "Bad Request", errors: {} };
					for (let err of error.errors) {
						errorObj.errors[err.path] = err.message;
					}
					res.status(400);
					res.json(errorObj);
				}
			} else {
				res.status(400);
				if (membership.status === "pending") {
					res.status(400);
					res.json({
						message: "Membership has already been requested",
					});
				} else {
					res.status(400);
					res.json({
						message: "User is already a member of the group",
					});
				}
			}
		} else {
			res.status(403);
			res.json({
				message: "User is the organizer of the group",
			});
		}
	} else {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
});

router.put("/:groupId", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;
	const { name, about, type, private, city, state } = req.body;

	let group = await Group.findByPk(groupId);
	if (group && group.organizerId === user.id) {
		try {
			if (name) group.name = name;
			if (about) group.about = about;
			if (type) group.type = type;
			if (private !== undefined) group.private = private;
			if (!city) group.city = city;
			if (!state) group.state = state;

			await group.validate();
			await group.save();

			res.json(group);
		} catch (error) {
			let errorObj = {
				message: "Bad Request",
				errors: {},
			};
			for (let err of error.errors) {
				errorObj.errors[err.path] = err.message;
			}
			res.statusCode = 400;
			res.json(errorObj);
		}
	} else {
		if (!group) {
			res.status(404);
			res.json({ message: "Group couldn't be found" });
		} else {
			res.status(403);
			res.json({ message: "Not the owner of this group" });
		}
	}
});

router.put("/:groupId/membership", requireAuth, async (req, res) => {
	const { user } = req;
	const { userId, status } = req.body;
	const groupId = +req.params.groupId;

	let group;

	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(400);
		res.json({
			message: "Group couldn't be found",
		});
	}

	if (group) {
		if (group.organizerId === user.id) {
			const otherUser = await User.findByPk(userId);

			if (otherUser) {
				const promotion = await Membership.findOne({
					where: {
						userId: user.id,
						groupId: group.id,
					},
				});

				if (promotion) {
					const pending = promotion.status === "pending";
					const member = promotion.status === "member";
					const coHost = promotion.status === "co-host";

					if (
						(status === "member" && (pending || coHost)) ||
						(status === "co-host" && (pending || member))
					) {
						if (group.organizerId !== user.id && status === "co-host") {
							res.status(403);
							return res.json({
								message: "User must be an organizer to promote to 'co-host",
							});
						}
						promotion.status = status;
						await promotion.validate();
						await promotion.save();

						const safePromotion = {
							id: promotion.id,
							userId: otherUser.id,
							status: promotion.status,
							groupId: group.id,
						};

						res.json(safePromotion);
					} else {
						let errorObj = { message: "Bad Request", errors: {} };
						if (status === "pending") {
							// console.log(errorObj.errors['status']);
							res.status(400);
							errorObj.errors["status"] =
								"Cannot change a membership status to pending";
						}
						res.json(errorObj);
					}
				} else {
					res.status(404);
					res.json({
						message: "Membership between the user and the group does not exist",
					});
				}
			} else {
				res.status(404);
				res.json({
					message: "Bad message",
					errors: {
						userId: "User to promote does not exist",
					},
				});
			}
		} else {
			const newPromotion = await Membership.findOne({
				where: {
					userId: user.id,
					groupId: group.id,
				},
			});

			if (newPromotion && newPromotion.status === "co-host") {
				const otherUser = await User.findByPk(userId);
				if (otherUser) {
					const promotion = await Membership.findOne({
						where: {
							userId: user.id,
							groupId: group.id,
						},
					});
					if (promotion) {
						if (status === "member" && promotion.status === "pending") {
							promotion.status = status;
							await promotion.validate();
							await promotion.save();

							const safePromotion = {
								id: promotion.id,
								userId: otherUser.id,
								status: promotion.status,
								groupId: group.id,
							};

							res.json(safePromotion);
						} else {
							let errorObj = { message: "Bad Request", errors: {} };
							if (status === "pending") {
								// console.log(errorObj.errors['status']);
								res.status(400);
								errorObj.errors["status"] =
									"Cannot change a membership status to pending";
							}
							res.json(errorObj);
						}
					} else {
						res.status(404);
						res.json({
							message:
								"Membership between the user and the group does not exist",
						});
					}
				} else {
					res.status(400);
					res.json({
						message: "Bad message",
						errors: {
							userId: "User to promote does not exist",
						},
					});
				}
			} else {
				res.status(403);
				res.json({
					message: "Invalid Request",
					errors: {
						user: "User is not a co-host or organizer of the group.",
					},
				});
			}
		}
	} else {
		res.status(404);
		res.json({
			message: "Group couldn't be found",
		});
	}
});

router.delete("/:groupId", requireAuth, async (req, res) => {
	const { user } = req;
	const groupId = +req.params.groupId;

	let group;

	try {
		group = await Group.findByPk(groupId);
	} catch (error) {
		res.status(404);
		res.json({ message: "Group couldn't be found" });
	}

	if (group && group.organizerId === user.id) {
		try {
			await group.destroy();

			res.json({ message: "Successfully deleted" });
		} catch (error) {
			let errorObj = { message: "Bad Request", errors: {} };
			for (let err of error.errors) {
				errorObj.errors[err.path] = err.message;
			}
			res.statusCode = 400;
			res.json(errorObj);
		}
	} else {
		if (!group) {
			res.status(404);
			res.json({ message: "Group couldn't be found" });
		} else {
			res.status(403);
			res.json({ message: "Not the owner of this group" });
		}
	}
});

router.delete(
	"/:groupId/membership/:memberId",
	requireAuth,
	async (req, res) => {
		const { user } = req;
		let memberId = +req.params.memberId;
		const groupId = +req.params.groupId;

		let group;

		try {
			group = await Group.findByPk(groupId);
		} catch (error) {
			res.status(404);
			res.json({
				message: "Group couldn't be found",
			});
		}

		if (group) {
			try {
				const verifyExist = await User.findByPk(memberId);
				if (!verifyExist) {
					res.status(404);
					return res.json({
						message: "User couldn't be found",
					});
				}
			} catch (error) {
				res.status(404);
				return res.json({
					message: "User couldn't be found",
				});
			}

			if (group.organizerId === user.id) {
				const verifyUser = await User.findByPk(memberId);
				if (verifyUser) {
					const membership = await Membership.findOne({
						where: {
							groupId: group.id,
							userId: verifyUser.id,
						},
					});
					if (membership) {
						await membership.destroy();
						res.json({
							message: "Successfully deleted membership from group",
						});
					} else {
						res.status(404);
						res.json({
							message: "Membership does not exist for this User",
						});
					}
				} else {
					res.status(400);
					res.json({
						message: "Bad Message",
						errors: {
							memberId: "User couldn't be found",
						},
					});
				}
			} else if (memberId === user.id) {
				const membership = await Membership.findOne({
					where: {
						groupId: group.id,
						userId: user.id,
					},
				});
				if (membership) {
					await membership.destroy();
					res.json({
						message: "Successfully deleted membership from group",
					});
				} else {
					res.status(404);
					res.json({
						message: "Membership does not exist for this User",
					});
				}
			} else {
				res.status(403);
				res.json({
					message:
						"User must be the organizer of the group or the user whose membership is being deleted",
				});
			}
		} else {
			res.status(404);
			res.json({ message: "Group couldn't be found" });
		}
	}
);
module.exports = router;
